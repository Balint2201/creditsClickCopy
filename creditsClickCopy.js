((async () => {
    const CREDIT_SELECTOR = 'div[class*="credit" i] a, div[class*="credit" i] span';
    const VERSION_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/version.json';
    const GLOBAL_SWITCH_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/globalswitch.json';
    const CURRENT_VERSION = '1.4.3';
    const STORAGE_KEY_ENABLED = "creditsClickCopy:enabled";
    const TRACK_CREDITS_EXPERIMENT_DESCRIPTION = "Enables the new TrackCreditsModal implementation";
    const TRACK_CREDITS_EXPERIMENT_RELOAD_MARKER = "creditsClickCopy:reloadedAfterDisablingTrackCreditsModal";
    const TRACK_CREDITS_EXPERIMENT_ENABLE_RELOAD_MARKER = "creditsClickCopy:reloadedAfterEnablingTrackCreditsModal";
    const DEFAULT_POPUP_LENGTH_MS = 4500;
    const DEBUG_KEY_PREFIX = "creditsClickCopy:debug:";

    let enabled = true;
    let enabledGlobally = true;
    let popupLengthMs = DEFAULT_POPUP_LENGTH_MS;
    let running = false;
    let observer;

    function setDebugValue(key, value) {
        try {
            localStorage.setItem(`${DEBUG_KEY_PREFIX}${key}`, String(value));
        } catch {}
    }

    function getDebugValue(key) {
        try {
            return localStorage.getItem(`${DEBUG_KEY_PREFIX}${key}`);
        } catch {
            return null;
        }
    }

    function ensureStyle() {
        if (document.getElementById("credits-click-copy-style")) return;
        if (!document.head) return;

        const style = document.createElement("style");
        style.id = "credits-click-copy-style";
        style.textContent = `
            .credits-copyable {
                cursor: copy;
            }
            .copied {
                opacity: 0.6;
                transition: opacity 150ms ease;
            }
            .ccc-toast {
                position: fixed;
                right: 16px;
                bottom: 72px;
                background: rgba(0,0,0,0.85);
                color: #fff;
                border-radius: 8px;
                padding: 10px 12px;
                font-size: 13px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                z-index: 99999;
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 150ms ease, transform 150ms ease;
                pointer-events: none;
            }
            .ccc-toast.show {
                opacity: 1;
                transform: translateY(0);
            }
            .ccc-about-debug {
                margin-top: 10px;
            }
            .ccc-about-debug summary {
                font-size: 14px;
                font-weight: 700;
                cursor: pointer;
                user-select: none;
            }
            .ccc-about-debug[open] summary {
                margin-bottom: 8px;
            }
            .ccc-about-debug .row {
                display: flex;
                gap: 10px;
                margin: 4px 0;
                flex-wrap: wrap;
            }
            .ccc-about-debug .k {
                font-weight: 600;
            }
            .ccc-about-debug .v {
                opacity: 0.9;
                word-break: break-word;
            }
        `;
        document.head.appendChild(style);
    }

    function getStoredEnabled() {
        try {
            const raw = window.Spicetify?.LocalStorage?.get?.(STORAGE_KEY_ENABLED) ?? localStorage.getItem(STORAGE_KEY_ENABLED);
            if (raw === null || raw === undefined || raw === "") return true;
            if (typeof raw === "boolean") return raw;
            const normalized = String(raw).toLowerCase();
            return normalized === "true" || normalized === "1" || normalized === "yes";
        } catch {
            return true;
        }
    }

    function setStoredEnabled(value) {
        const serialized = value ? "true" : "false";
        try {
            window.Spicetify?.LocalStorage?.set?.(STORAGE_KEY_ENABLED, serialized);
        } catch {}
        try {
            localStorage.setItem(STORAGE_KEY_ENABLED, serialized);
        } catch {}
    }

    function getCopyTargetFromEventTarget(target) {
        if (!target?.closest) return null;
        const candidate = target.closest(CREDIT_SELECTOR);
        if (!candidate) return null;
        return candidate;
    }

    function copyText(text) {
        navigator.clipboard.writeText(text).catch(() => {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            textarea.remove();
        });
    }

    function mark(el) {
        if (el.dataset.copyHooked) return;
        el.dataset.copyHooked = "true";
        el.classList.add("credits-copyable");
    }

    function unmarkAll() {
        document.querySelectorAll(".credits-copyable").forEach(el => {
            delete el.dataset.copyHooked;
            el.classList.remove("credits-copyable");
            el.classList.remove("copied");
        });
    }

    function hookAllMatchingElements() {
        document.querySelectorAll(CREDIT_SELECTOR).forEach(mark);
    }

    function onDocumentClick(e) {
        if (!enabled) return;
        if (e.defaultPrevented) return;
        if (e.button !== 0) return;

        const el = getCopyTargetFromEventTarget(e.target);
        if (!el) return;
        mark(el);

        e.preventDefault();
        e.stopPropagation();

        const text = el.textContent?.trim();
        if (!text) return;

        copyText(text);

        el.classList.add("copied");
        setTimeout(() => el.classList.remove("copied"), 150);
    }

    function start() {
        if (running) return;
        if (!document.body) {
            setTimeout(start, 100);
            return;
        }

        ensureStyle();
        setDebugValue("lastStartedAt", new Date().toISOString());

        running = true;
        document.addEventListener("click", onDocumentClick, true);

        observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches?.(CREDIT_SELECTOR)) mark(node);
                    node.querySelectorAll?.(CREDIT_SELECTOR).forEach(mark);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        hookAllMatchingElements();
        checkVersion();
    }

    function stop() {
        if (!running) return;
        running = false;

        setDebugValue("lastStoppedAt", new Date().toISOString());

        document.removeEventListener("click", onDocumentClick, true);
        observer?.disconnect();
        observer = undefined;

        unmarkAll();
    }

    function showToast(text, durationMs = popupLengthMs) {
        ensureStyle();
        if (!document.body) {
            setTimeout(() => showToast(text, durationMs), 150);
            return;
        }

        let el = document.getElementById("ccc-toast");
        if (!el) {
            el = document.createElement("div");
            el.id = "ccc-toast";
            el.className = "ccc-toast";
            el.textContent = text;
            document.body.appendChild(el);
            requestAnimationFrame(() => el.classList.add("show"));
        } else {
            el.textContent = text;
            el.classList.add("show");
        }

        const finalDuration = Number.isFinite(durationMs) ? Math.max(500, durationMs) : DEFAULT_POPUP_LENGTH_MS;
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => {
            el.classList.remove("show");
            setTimeout(() => el.remove(), 200);
        }, finalDuration);
    }

    function checkVersion() {
        fetch(VERSION_URL, { cache: "no-store" })
            .then(r => r.ok ? r.json() : null)
            .then(json => {
                if (!json || !json.version) return;
                setDebugValue("lastVersionCheckAt", new Date().toISOString());
                setDebugValue("lastLatestVersion", String(json.version));
                if (String(json.version) !== String(CURRENT_VERSION)) {
                    showToast(`creditsClickCopy: Update available. Current: v${CURRENT_VERSION} · Latest: v${json.version}`);
                }
            })
            .catch(() => {});
    }

    function setupMenuToggle() {
        if (!window.Spicetify?.Menu?.Item) {
            setTimeout(setupMenuToggle, 300);
            return;
        }

        const menuItem = new Spicetify.Menu.Item(
            "creditsClickCopy",
            enabled,
            async (self) => {
                const next = !self.isEnabled;
                self.setState(next);

                enabled = next;
                setStoredEnabled(enabled);

                if (enabled) {
                    const status = await setTrackCreditsModalExperimentDisabled().catch(() => null);
                    if (status?.failed && status?.effective !== false) {
                        showToast(`creditsClickCopy: Couldn't disable the experiment "${TRACK_CREDITS_EXPERIMENT_DESCRIPTION}". The extension may not work.`);
                    }
                    start();
                } else {
                    stop();
                    await setTrackCreditsModalExperimentEnabled().catch(() => {});
                }

                try {
                    window.Spicetify?.showNotification?.(`creditsClickCopy ${enabled ? "enabled" : "disabled"}`);
                } catch {}
            }
        );

        menuItem.register();
    }

    function coerceBoolean(value) {
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (normalized === "true") return true;
            if (normalized === "false") return false;
        }
        if (typeof value === "number") {
            if (value === 1) return true;
            if (value === 0) return false;
        }
        return undefined;
    }

    function getRemoteConfigEffectiveBoolean(prop) {
        if (!prop) return undefined;
        const candidates = [
            prop.effectiveValue,
            prop.resolvedValue,
            prop.currentValue,
            prop.value
        ];
        for (const candidate of candidates) {
            const coerced = coerceBoolean(candidate);
            if (typeof coerced === "boolean") return coerced;
        }
        return undefined;
    }

    function waitFor(predicate, { intervalMs = 250, timeoutMs = 5000 } = {}) {
        return new Promise(resolve => {
            const start = Date.now();
            const tick = () => {
                try {
                    if (predicate()) return resolve(true);
                } catch {}

                if (Date.now() - start >= timeoutMs) return resolve(false);
                setTimeout(tick, intervalMs);
            };
            tick();
        });
    }

    function clampPopupLengthMs(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return undefined;
        return Math.min(60000, Math.max(500, n));
    }

    async function getGlobalSwitch() {
        try {
            const r = await fetch(GLOBAL_SWITCH_URL, { cache: "no-store" });
            if (!r.ok) return null;
            const json = await r.json();
            if (!json || typeof json !== "object") return null;

            const enabledFlag = json.enabled_globally;
            if (typeof enabledFlag !== "boolean") return null;

            const message = typeof json.message === "string" ? json.message : "";
            const len = clampPopupLengthMs(json.popuplenght);

            return {
                enabled_globally: enabledFlag,
                message,
                popuplenght: len
            };
        } catch {
            return null;
        }
    }

    function findAboutAnchorElement() {
        const needleA = /spicetify/i;
        const needleB = /spotify/i;
        const nodes = document.querySelectorAll("main, section, div");
        let best = null;
        let bestLen = Infinity;
        for (const el of nodes) {
            const text = el.textContent;
            if (!text) continue;
            if (!needleA.test(text) || !needleB.test(text) || !/version/i.test(text)) continue;
            const len = text.length;
            if (len < bestLen) {
                best = el;
                bestLen = len;
            }
        }
        return best;
    }

    function findSpicetifyRowElement(aboutRoot) {
        if (!aboutRoot?.querySelectorAll) return null;
        const nodes = aboutRoot.querySelectorAll("div, section, p, span, li");
        let best = null;
        let bestLen = Infinity;
        for (const el of nodes) {
            const text = el.textContent;
            if (!text) continue;
            if (!/spicetify/i.test(text) || !/version/i.test(text)) continue;
            const len = text.length;
            if (len < bestLen) {
                best = el;
                bestLen = len;
            }
        }
        return best;
    }

    function renderAboutDebugBlock() {
        if (!document.body) return;
        const anchor = findAboutAnchorElement();
        if (!anchor) return;

        ensureStyle();

        let block = document.getElementById("ccc-about-debug");
        if (!block) {
            block = document.createElement("details");
            block.id = "ccc-about-debug";
            block.className = "ccc-about-debug";
            const summary = document.createElement("summary");
            summary.textContent = "creditsClickCopy (DEBUG)";
            block.appendChild(summary);

            const spicetifyRow = findSpicetifyRowElement(anchor);
            if (spicetifyRow?.insertAdjacentElement) spicetifyRow.insertAdjacentElement("afterend", block);
            else anchor.appendChild(block);
        }

        const rows = [
            ["Version", CURRENT_VERSION],
            ["Local enabled", String(getStoredEnabled())],
            ["Global enabled", String(enabledGlobally)],
            ["Global switch fetched", getDebugValue("lastGlobalSwitchFetchAt") || "(unknown)"],
            ["Global switch message", getDebugValue("globalSwitchMessage") || ""],
            ["Popup length (ms)", String(popupLengthMs)],
            ["Last loaded", getDebugValue("lastLoadedAt") || "(unknown)"],
            ["Last started", getDebugValue("lastStartedAt") || "(never)"],
            ["Last stopped", getDebugValue("lastStoppedAt") || "(never)"],
            ["Experiment last action", getDebugValue("lastExperimentAt") || "(unknown)"],
            ["Experiment desired", getDebugValue("lastExperimentDesired") || "(unknown)"],
            ["Experiment result", getDebugValue("lastExperimentResult") || "(unknown)"],
            ["Version check", getDebugValue("lastVersionCheckAt") || "(unknown)"],
            ["Latest version", getDebugValue("lastLatestVersion") || "(unknown)"],
        ];

        const summary = block.querySelector("summary");
        block.innerHTML = "";
        if (summary) block.appendChild(summary);
        else {
            const s = document.createElement("summary");
            s.textContent = "creditsClickCopy (DEBUG)";
            block.appendChild(s);
        }

        const container = document.createElement("div");
        block.appendChild(container);

        for (const [k, v] of rows) {
            const row = document.createElement("div");
            row.className = "row";
            const keyEl = document.createElement("div");
            keyEl.className = "k";
            keyEl.textContent = `${k}:`;
            const valueEl = document.createElement("div");
            valueEl.className = "v";
            valueEl.textContent = v;
            row.appendChild(keyEl);
            row.appendChild(valueEl);
            container.appendChild(row);
        }
    }

    async function setupAboutDebugInjection() {
        const hasHistory = await waitFor(
            () => !!window.Spicetify?.Platform?.History?.listen,
            { intervalMs: 250, timeoutMs: 6000 }
        );

        const attempt = () => {
            try { renderAboutDebugBlock(); } catch {}
        };

        attempt();

        if (hasHistory) {
            try {
                window.Spicetify.Platform.History.listen(() => {
                    setTimeout(attempt, 300);
                    setTimeout(attempt, 1200);
                });
            } catch {}
        } else {
            setInterval(attempt, 2000);
        }
    }

    async function setTrackCreditsModalExperimentOverride(desiredValue, reloadMarkerKey) {
        const hasApi = await waitFor(
            () => !!window.Spicetify?.Platform?.RemoteConfigDebugAPI?.getProperties,
            { intervalMs: 250, timeoutMs: 6000 }
        );

        const api = window.Spicetify?.Platform?.RemoteConfigDebugAPI;
        if (!hasApi || !api?.getProperties || !api?.setOverride) {
            return { effective: undefined, overridden: false, failed: true };
        }

        let props;
        try {
            props = await api.getProperties();
        } catch {
            return { effective: undefined, overridden: false, failed: true };
        }

        const target = props?.find?.(p =>
            (p?.description?.trim?.() === TRACK_CREDITS_EXPERIMENT_DESCRIPTION) ||
            (/TrackCreditsModal/i.test(p?.description || ""))
        );
        if (!target?.name) return { effective: undefined, overridden: false, failed: true };

        const currentEffective = getRemoteConfigEffectiveBoolean(target);
        if (currentEffective === desiredValue) {
            return { effective: currentEffective, overridden: false, failed: false };
        }

        try {
            await api.setOverride(
                { source: "web", type: "boolean", name: target.name },
                desiredValue
            );
        } catch {
            return { effective: currentEffective, overridden: false, failed: true };
        }

        if (currentEffective === !desiredValue) {
            try {
                if (!sessionStorage.getItem(reloadMarkerKey)) {
                    sessionStorage.setItem(reloadMarkerKey, "1");
                    location.reload();
                }
            } catch {}
        }

        return { effective: currentEffective, overridden: true, failed: false };
    }

    function setTrackCreditsModalExperimentDisabled() {
        try { sessionStorage.removeItem(TRACK_CREDITS_EXPERIMENT_ENABLE_RELOAD_MARKER); } catch {}
        return setTrackCreditsModalExperimentOverride(false, TRACK_CREDITS_EXPERIMENT_RELOAD_MARKER);
    }

    function setTrackCreditsModalExperimentEnabled() {
        try { sessionStorage.removeItem(TRACK_CREDITS_EXPERIMENT_RELOAD_MARKER); } catch {}
        return setTrackCreditsModalExperimentOverride(true, TRACK_CREDITS_EXPERIMENT_ENABLE_RELOAD_MARKER);
    }

    const globalSwitch = await getGlobalSwitch();
    if (globalSwitch?.popuplenght !== undefined) popupLengthMs = globalSwitch.popuplenght;

    if (globalSwitch && globalSwitch.enabled_globally === false) {
        enabledGlobally = false;
        showToast(`creditsClickCopy: Extension disabled globally, reason: ${globalSwitch.message}`);
        return;
    }

    enabled = getStoredEnabled();
    enabledGlobally = true;
    setDebugValue("lastLoadedAt", new Date().toISOString());

    if (globalSwitch) {
        setDebugValue("lastGlobalSwitchFetchAt", new Date().toISOString());
        setDebugValue("globalSwitchEnabled", String(globalSwitch.enabled_globally));
        setDebugValue("globalSwitchMessage", globalSwitch.message);
        if (globalSwitch.popuplenght !== undefined) setDebugValue("globalSwitchPopupLength", String(globalSwitch.popuplenght));
    }

    setupAboutDebugInjection().catch(() => {});

    if (enabled) {
        const expStatus = await setTrackCreditsModalExperimentDisabled();
        setDebugValue("lastExperimentAt", new Date().toISOString());
        setDebugValue("lastExperimentDesired", "false");
        setDebugValue("lastExperimentResult", JSON.stringify(expStatus));
        if (expStatus?.failed && expStatus?.effective !== false) {
            showToast(`creditsClickCopy: Couldn't disable the experiment "${TRACK_CREDITS_EXPERIMENT_DESCRIPTION}". The extension may not work.`);
        }
        start();
    } else {
        const expStatus = await setTrackCreditsModalExperimentEnabled().catch(() => null);
        setDebugValue("lastExperimentAt", new Date().toISOString());
        setDebugValue("lastExperimentDesired", "true");
        setDebugValue("lastExperimentResult", JSON.stringify(expStatus));
        stop();
    }
    setupMenuToggle();
})());