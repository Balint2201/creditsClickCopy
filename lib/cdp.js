"use strict";

/**
 * A very small Chrome DevTools Protocol client.
 *
 * Spotify's desktop app is Chromium (CEF), so when it is started with
 * `--remote-debugging-port` it exposes the same protocol Chrome does: an HTTP
 * endpoint that lists targets, and one WebSocket per target that speaks CDP.
 *
 * Node's built-in global WebSocket (Node 22+) is all we need — no dependencies.
 */

const http = require("http");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9222;

class CdpError extends Error {}

function httpJson(host, port, path, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const request = http.get({ host, port, path, timeout: timeoutMs }, response => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", chunk => { body += chunk; });
            response.on("end", () => {
                if (response.statusCode !== 200) {
                    reject(new CdpError(`${path} returned HTTP ${response.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new CdpError(`${path} returned invalid JSON: ${error.message}`));
                }
            });
        });

        request.on("timeout", () => {
            request.destroy(new CdpError(`timed out talking to ${host}:${port}`));
        });
        request.on("error", error => {
            reject(error instanceof CdpError ? error : new CdpError(describeConnectError(error, host, port)));
        });
    });
}

function describeConnectError(error, host, port) {
    if (error.code === "ECONNREFUSED") {
        return `nothing is listening on ${host}:${port} — start Spotify with --remote-debugging-port=${port} (try: ccc launch --restart)`;
    }
    return `${host}:${port}: ${error.message}`;
}

/** One open CDP connection to a single target. */
class CdpSession {
    constructor(socket, target) {
        this.socket = socket;
        this.target = target;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
        this.closed = false;

        socket.addEventListener("message", event => this.#onMessage(event.data));
        socket.addEventListener("close", () => this.#onClose());
    }

    static connect(target, { timeoutMs = 8000 } = {}) {
        if (typeof WebSocket === "undefined") {
            throw new CdpError("this Node build has no global WebSocket — Node 22 or newer is required");
        }

        return new Promise((resolve, reject) => {
            const socket = new WebSocket(target.webSocketDebuggerUrl);
            const timer = setTimeout(() => {
                socket.close();
                reject(new CdpError(`timed out connecting to ${target.webSocketDebuggerUrl}`));
            }, timeoutMs);

            socket.addEventListener("open", () => {
                clearTimeout(timer);
                resolve(new CdpSession(socket, target));
            }, { once: true });

            socket.addEventListener("error", () => {
                clearTimeout(timer);
                reject(new CdpError(`could not open ${target.webSocketDebuggerUrl}`));
            }, { once: true });
        });
    }

    #onMessage(data) {
        let message;
        try {
            message = JSON.parse(typeof data === "string" ? data : String(data));
        } catch {
            return;
        }

        if (message.id !== undefined) {
            const entry = this.pending.get(message.id);
            if (!entry) return;
            this.pending.delete(message.id);
            if (message.error) entry.reject(new CdpError(`${entry.method}: ${message.error.message}`));
            else entry.resolve(message.result);
            return;
        }

        for (const handler of this.listeners.get(message.method) || []) {
            handler(message.params || {});
        }
    }

    #onClose() {
        this.closed = true;
        for (const entry of this.pending.values()) {
            entry.reject(new CdpError(`connection closed while waiting for ${entry.method}`));
        }
        this.pending.clear();
    }

    send(method, params = {}) {
        if (this.closed) return Promise.reject(new CdpError("connection is closed"));

        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, method });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    on(event, handler) {
        const handlers = this.listeners.get(event) || [];
        handlers.push(handler);
        this.listeners.set(event, handlers);
    }

    /** Runs an expression in the page and returns its value, throwing page exceptions. */
    async evaluate(expression, { awaitPromise = true, returnByValue = true } = {}) {
        const result = await this.send("Runtime.evaluate", {
            expression,
            awaitPromise,
            returnByValue,
            userGesture: true,
            allowUnsafeEvalBlockedByCSP: true,
        });

        if (result.exceptionDetails) {
            const details = result.exceptionDetails;
            const message = details.exception?.description || details.text || "evaluation failed";
            throw new CdpError(message);
        }
        return result.result?.value;
    }

    close() {
        this.closed = true;
        try { this.socket.close(); } catch { /* already gone */ }
    }
}

async function listTargets(host = DEFAULT_HOST, port = DEFAULT_PORT) {
    const targets = await httpJson(host, port, "/json/list");
    return targets.filter(target => target.webSocketDebuggerUrl);
}

/**
 * Finds the renderer that actually hosts the Spotify UI.
 *
 * Spotify runs several CEF pages (the app, widgets, the mini player), so rather
 * than guessing from titles we connect and ask each one whether Spicetify is
 * loaded in it. `xpui` pages are tried first because that is nearly always it.
 */
async function connectToSpotify({ host = DEFAULT_HOST, port = DEFAULT_PORT, targetId = null } = {}) {
    const targets = await listTargets(host, port);
    if (targets.length === 0) throw new CdpError(`no debuggable targets on ${host}:${port}`);

    if (targetId) {
        const chosen = targets.find(target => target.id === targetId);
        if (!chosen) throw new CdpError(`no target with id ${targetId}`);
        return CdpSession.connect(chosen);
    }

    const pages = targets.filter(target => target.type === "page");
    const candidates = (pages.length ? pages : targets).sort((a, b) => score(b) - score(a));

    let fallback = null;
    for (const candidate of candidates) {
        let session;
        try {
            session = await CdpSession.connect(candidate);
        } catch {
            continue;
        }

        try {
            if (await session.evaluate("typeof Spicetify !== 'undefined' && !!Spicetify.Platform")) return session;
        } catch { /* target is not scriptable */ }

        if (!fallback) fallback = session;
        else session.close();
    }

    if (fallback) return fallback;
    throw new CdpError("connected, but no target would evaluate JavaScript");
}

function score(target) {
    const url = String(target.url || "");
    const title = String(target.title || "");
    let value = 0;
    if (url.includes("xpui")) value += 10;
    if (url.includes("spotify")) value += 5;
    if (/^Spotify/i.test(title)) value += 3;
    if (url.includes("mini-player") || url.includes("widget")) value -= 10;
    return value;
}

module.exports = { CdpError, CdpSession, connectToSpotify, listTargets, DEFAULT_HOST, DEFAULT_PORT };
