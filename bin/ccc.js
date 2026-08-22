#!/usr/bin/env node
"use strict";

/**
 * ccc — live-inject creditsClickCopy into a running Spotify client.
 *
 * Spotify is Chromium under the hood, so if it was started with
 * `--remote-debugging-port` we can evaluate the extension straight into the
 * running UI: no `spicetify apply`, no restart, no reinstall.
 */

const fs = require("fs");
const path = require("path");

const { connectToSpotify, listTargets, CdpError, DEFAULT_HOST, DEFAULT_PORT } = require("../lib/cdp");
const spotify = require("../lib/spotify");

const ROOT = path.resolve(__dirname, "..");
const EXTENSION_FILE = path.join(ROOT, "creditsClickCopy.js");
const LOADER_FILE = path.join(ROOT, "creditsClickCopy-load.js");

/* -------------------------------------------------------------------------- */
/* argument parsing                                                            */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
    const flags = {};
    const positionals = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) {
            positionals.push(arg);
            continue;
        }

        const [key, inlineValue] = arg.slice(2).split(/=(.*)/s);
        if (inlineValue !== undefined) {
            flags[key] = inlineValue;
        } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
            flags[key] = argv[++i];
        } else {
            flags[key] = true;
        }
    }

    return { command: positionals.shift() || "help", positionals, flags };
}

function connectionOptions(flags) {
    return {
        host: flags.host || DEFAULT_HOST,
        port: Number(flags.port || DEFAULT_PORT),
        targetId: flags.target || null,
    };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* commands                                                                    */
/* -------------------------------------------------------------------------- */

function sourceFor(flags) {
    if (flags.remote) return { file: LOADER_FILE, label: "loader (fetches from GitHub)" };
    const file = flags.file ? path.resolve(String(flags.file)) : EXTENSION_FILE;
    return { file, label: path.relative(process.cwd(), file) || file };
}

async function injectSource(session, file) {
    const code = fs.readFileSync(file, "utf8");
    await session.evaluate(`${code}\n//# sourceURL=${path.basename(file)}`);
    return session.evaluate("window.creditsClickCopy ? window.creditsClickCopy.version : null");
}

async function cmdInject(flags) {
    const { file, label } = sourceFor(flags);
    const session = await connectToSpotify(connectionOptions(flags));

    try {
        const version = await injectSource(session, file);
        if (version) console.log(`injected ${label} — creditsClickCopy v${version} is live`);
        else console.log(`evaluated ${label}, but window.creditsClickCopy is not set (loader still fetching?)`);
    } finally {
        session.close();
    }
}

async function cmdWatch(flags) {
    const { file, label } = sourceFor(flags);
    let session = await connectToSpotify(connectionOptions(flags));

    const reinject = async () => {
        try {
            if (session.closed) session = await connectToSpotify(connectionOptions(flags));
            const version = await injectSource(session, file);
            console.log(`${new Date().toLocaleTimeString()}  reinjected v${version}`);
        } catch (error) {
            console.error(`${new Date().toLocaleTimeString()}  ${error.message}`);
        }
    };

    await reinject();
    console.log(`watching ${label} — press Ctrl+C to stop`);

    let timer = null;
    fs.watch(path.dirname(file), (_event, changed) => {
        if (changed !== path.basename(file)) return;
        clearTimeout(timer);
        timer = setTimeout(reinject, 150);
    });
}

async function cmdUninject(flags) {
    const session = await connectToSpotify(connectionOptions(flags));
    try {
        const wasInstalled = await session.evaluate(
            "(() => { const was = !!window.creditsClickCopy; window.creditsClickCopy?.destroy?.(); return was; })()"
        );
        console.log(wasInstalled ? "destroyed the running instance" : "nothing was injected");
    } finally {
        session.close();
    }
}

async function cmdReload(flags) {
    const session = await connectToSpotify(connectionOptions(flags));
    try {
        await session.send("Page.enable");
        await session.send("Page.reload", { ignoreCache: Boolean(flags.hard) });
        console.log("reloading the Spotify UI");
    } finally {
        session.close();
    }
}

async function cmdEval(flags, positionals) {
    const expression = positionals.join(" ");
    if (!expression) throw new Error('usage: ccc eval "<javascript>"');

    const session = await connectToSpotify(connectionOptions(flags));
    try {
        const value = await session.evaluate(expression);
        console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    } finally {
        session.close();
    }
}

async function cmdStatus(flags) {
    const options = connectionOptions(flags);
    const targets = await listTargets(options.host, options.port);

    console.log(`devtools on ${options.host}:${options.port} — ${targets.length} target(s)`);
    for (const target of targets) {
        console.log(`  [${target.type}] ${target.title || "(untitled)"}  ${target.id}`);
    }

    const session = await connectToSpotify(options);
    try {
        // findCreditsRoot() is what updates the variant fields, so run it before debug().
        const info = await session.evaluate(`(() => {
            const creditsModalOpen = !!window.creditsClickCopy?.findCreditsRoot?.();
            return {
                spicetify: window.Spicetify?.Config?.version ?? null,
                userAgent: navigator.userAgent,
                extension: window.creditsClickCopy?.debug?.() ?? null,
                creditsModalOpen,
            };
        })()`);

        console.log(`\nconnected target : ${session.target.title || session.target.id}`);
        console.log(`spicetify        : ${info.spicetify || "(not detected)"}`);
        console.log(`spotify UA       : ${info.userAgent}`);

        if (!info.extension) {
            console.log("extension        : not injected (run: ccc inject)");
            return;
        }

        console.log(`extension        : v${info.extension.version} (${info.extension.enabled ? "enabled" : "disabled"})`);
        console.log(`credits modal    : ${info.creditsModalOpen ? `open, variant "${info.extension.creditsVariant}" via ${info.extension.detectionTier}` : "closed"}`);
        console.log(`last copied      : ${info.extension.lastCopiedText || "(nothing yet)"}`);
        console.log(`last error       : ${info.extension.lastError || "(none)"}`);
    } finally {
        session.close();
    }
}

async function cmdLogs(flags) {
    const session = await connectToSpotify(connectionOptions(flags));
    const filter = flags.filter ? String(flags.filter).toLowerCase() : null;

    const render = value => {
        if (value === undefined) return "undefined";
        if (value.value !== undefined) return typeof value.value === "string" ? value.value : JSON.stringify(value.value);
        return value.description || value.type;
    };

    session.on("Runtime.consoleAPICalled", params => {
        const line = (params.args || []).map(render).join(" ");
        if (filter && !line.toLowerCase().includes(filter)) return;
        console.log(`[${params.type}] ${line}`);
    });

    session.on("Runtime.exceptionThrown", params => {
        const details = params.exceptionDetails || {};
        console.error(`[error] ${details.exception?.description || details.text}`);
    });

    await session.send("Runtime.enable");
    console.log(`streaming console output${filter ? ` matching "${flags.filter}"` : ""} — press Ctrl+C to stop`);
}

async function cmdLaunch(flags) {
    const port = Number(flags.port || DEFAULT_PORT);
    const binary = spotify.findSpotifyBinary();
    if (!binary) throw new Error("could not find the Spotify desktop client — pass its path with --binary");

    if (spotify.isSpotifyRunning()) {
        if (!flags.restart) {
            throw new Error(
                "Spotify is already running, and a running client cannot be given the debug port.\n" +
                "  Re-run as: ccc launch --restart   (this closes the current Spotify)"
            );
        }
        console.log("closing the running Spotify…");
        spotify.stopSpotify();
        await sleep(1500);
    }

    const pid = spotify.launchSpotify(flags.binary ? String(flags.binary) : binary, port);
    console.log(`started Spotify (pid ${pid}) with --remote-debugging-port=${port}`);

    process.stdout.write("waiting for the debug port");
    for (let attempt = 0; attempt < 40; attempt++) {
        await sleep(500);
        try {
            await listTargets(flags.host || DEFAULT_HOST, port);
            console.log("\ndebug port is up — you can now run: ccc inject");
            return;
        } catch {
            process.stdout.write(".");
        }
    }
    console.log("\nthe debug port never came up; check that this Spotify build accepts the flag");
}

function cmdInstall(flags) {
    const userData = spotify.findSpicetifyUserDataDir();
    if (!userData) throw new Error("could not find the Spicetify user data directory — is Spicetify installed?");

    const extensionsDir = path.join(userData, "Extensions");
    fs.mkdirSync(extensionsDir, { recursive: true });

    const destination = path.join(extensionsDir, path.basename(LOADER_FILE));
    fs.copyFileSync(LOADER_FILE, destination);
    console.log(`copied loader to ${destination}`);

    console.log("\nnow enable it:");
    console.log("  spicetify config extensions creditsClickCopy-load.js");
    console.log("  spicetify apply");
}

function cmdHelp() {
    console.log(`ccc — live-inject creditsClickCopy into Spotify

usage: ccc <command> [options]

commands
  inject            evaluate creditsClickCopy.js in the running client
  watch             inject, then re-inject on every save
  uninject          tear the running instance down again
  reload            reload the Spotify UI (--hard to bypass the cache)
  eval "<js>"       evaluate an expression in the client and print the result
  logs              stream the client's console (--filter <text>)
  status            show targets, Spicetify version and extension state
  launch            start Spotify with the debug port (--restart to replace a running one)
  install           copy the loader into Spicetify's Extensions directory

options
  --port <n>        devtools port (default ${DEFAULT_PORT})
  --host <host>     devtools host (default ${DEFAULT_HOST})
  --target <id>     pick a specific devtools target instead of auto-detecting
  --file <path>     inject this file instead of ./creditsClickCopy.js
  --remote          inject the loader, so the script comes from GitHub

getting started
  ccc launch --restart      # Spotify must be started with the debug port
  ccc inject                # push your local changes into the live client
  ccc watch                 # keep pushing them on every save`);
}

/* -------------------------------------------------------------------------- */

const COMMANDS = {
    inject: cmdInject,
    watch: cmdWatch,
    uninject: cmdUninject,
    reload: cmdReload,
    eval: cmdEval,
    logs: cmdLogs,
    status: cmdStatus,
    launch: cmdLaunch,
    install: cmdInstall,
    help: cmdHelp,
};

async function main() {
    const { command, positionals, flags } = parseArgs(process.argv.slice(2));
    const handler = COMMANDS[command];

    if (!handler) {
        console.error(`unknown command "${command}"\n`);
        cmdHelp();
        process.exitCode = 1;
        return;
    }

    await handler(flags, positionals);
}

main().catch(error => {
    console.error(error instanceof CdpError ? `ccc: ${error.message}` : `ccc: ${error.message || error}`);
    process.exitCode = 1;
});
