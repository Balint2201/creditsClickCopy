"use strict";

/** Locating, launching and restarting the Spotify desktop client, per platform. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

function firstExisting(candidates) {
    return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function findSpotifyBinary() {
    if (IS_WINDOWS) {
        return firstExisting([
            process.env.APPDATA && path.join(process.env.APPDATA, "Spotify", "Spotify.exe"),
            process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Spotify", "Spotify.exe"),
        ]);
    }

    if (IS_MAC) {
        return firstExisting([
            "/Applications/Spotify.app/Contents/MacOS/Spotify",
            path.join(os.homedir(), "Applications/Spotify.app/Contents/MacOS/Spotify"),
        ]);
    }

    const fromPath = spawnSync("which", ["spotify"], { encoding: "utf8" });
    if (fromPath.status === 0 && fromPath.stdout.trim()) return fromPath.stdout.trim();

    return firstExisting([
        "/usr/bin/spotify",
        "/usr/share/spotify/spotify",
        "/var/lib/flatpak/exports/bin/com.spotify.Client",
        path.join(os.homedir(), ".local/share/flatpak/exports/bin/com.spotify.Client"),
    ]);
}

function isSpotifyRunning() {
    if (IS_WINDOWS) {
        const result = spawnSync("tasklist", ["/FI", "IMAGENAME eq Spotify.exe", "/NH"], { encoding: "utf8" });
        return /Spotify\.exe/i.test(result.stdout || "");
    }

    const result = spawnSync("pgrep", ["-x", IS_MAC ? "Spotify" : "spotify"], { encoding: "utf8" });
    return result.status === 0;
}

function stopSpotify() {
    if (IS_WINDOWS) {
        spawnSync("taskkill", ["/IM", "Spotify.exe", "/F"], { encoding: "utf8" });
    } else {
        spawnSync("pkill", ["-x", IS_MAC ? "Spotify" : "spotify"], { encoding: "utf8" });
    }
}

function launchSpotify(binary, port, extraArgs = []) {
    const child = spawn(binary, [`--remote-debugging-port=${port}`, ...extraArgs], {
        detached: true,
        stdio: "ignore",
    });
    child.unref();
    return child.pid;
}

/** Where Spicetify keeps user data — ask the CLI first, then fall back to defaults. */
function findSpicetifyUserDataDir() {
    const result = spawnSync("spicetify", ["path", "userdata"], { encoding: "utf8" });
    const reported = (result.stdout || "").trim().split(/\r?\n/).pop();
    if (result.status === 0 && reported && fs.existsSync(reported)) return reported;

    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    return firstExisting([
        IS_WINDOWS && process.env.APPDATA && path.join(process.env.APPDATA, "spicetify"),
        path.join(configHome, "spicetify"),
        path.join(os.homedir(), ".spicetify"),
    ]);
}

module.exports = {
    IS_WINDOWS,
    findSpotifyBinary,
    isSpotifyRunning,
    stopSpotify,
    launchSpotify,
    findSpicetifyUserDataDir,
};
