((async () => {
    const CREDIT_SELECTOR = 'div[class*="credit" i] a, div[class*="credit" i] span';
    const CREDITS_MODAL_ROOT_SELECTOR = '.main-trackCreditsModal-container';
    const CREDITS_CLOSE_BUTTON_SELECTOR = 'button.main-trackCreditsModal-closeBtn';
    const VERSION_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/version.json';
    const GLOBAL_SWITCH_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/globalswitch.json';
    const STORAGE_KEY_ENABLED = "creditsClickCopy:enabled";
    const TRACK_CREDITS_EXPERIMENT_DESCRIPTIONS = [
        "Enables grouped credits display in TrackCreditsModal (credits grouped by role category)",
        "Enables the new TrackCreditsModal implementation",
    ];
    const TRACK_CREDITS_EXPERIMENT_RELOAD_MARKER = "creditsClickCopy:reloadedAfterDisablingTrackCreditsModal";
    const TRACK_CREDITS_EXPERIMENT_ENABLE_RELOAD_MARKER = "creditsClickCopy:reloadedAfterEnablingTrackCreditsModal";
    const DEFAULT_POPUP_LENGTH_MS = 4500;
    const DEBUG_KEY_PREFIX = "creditsClickCopy:debug:";
    // Version
    const CURRENT_VERSION = '1.5.3';

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

    function getTrackCreditsExperimentLabel() {
        return TRACK_CREDITS_EXPERIMENT_DESCRIPTIONS[0];
    }

    function getTrackCreditsExperimentTarget(props, description) {
        const exactMatch = (props || []).find(p => String(p?.description || "").trim() === description);
        if (exactMatch) return exactMatch;

        return (props || []).find(p => /TrackCreditsModal/i.test(String(p?.description || "")));
    }

    function shouldReloadAfterTrackCreditsExperimentChange(previousEffective, desiredValue) {
        return previousEffective === !desiredValue;
    }

    function shouldReloadAfterAnyTrackCreditsExperimentChange(statusList) {
        return Array.isArray(statusList) && statusList.some(status => status?.requiresReload);
    }

    function ensureStyle() {
        if (document.getElementById("credits-click-copy-style")) return;
        if (!document.head) return;

        const style = document.createElement("style");
        style.id = "credits-click-copy-style";
        style.textContent = `
            ${CREDITS_MODAL_ROOT_SELECTOR} div[class*="credit" i] a,
            ${CREDITS_MODAL_ROOT_SELECTOR} div[class*="credit" i] span {
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
            .ccc-about-debug button {
                cursor: pointer;
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

    function isElementVisible(el) {
        if (!el || el.nodeType !== 1) return false;
        try {
            if (el.getClientRects().length === 0) return false;
        } catch {}
        try {
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        } catch {}
        return true;
    }

    function getOpenCreditsModalRoot() {
        // Strongest signal: the Credits modal close button.
        try {
            const buttons = Array.from(document.querySelectorAll(CREDITS_CLOSE_BUTTON_SELECTOR));
            for (let i = buttons.length - 1; i >= 0; i--) {
                const btn = buttons[i];
                if (!isElementVisible(btn)) continue;
                const root = btn.closest(CREDITS_MODAL_ROOT_SELECTOR);
                if (!root) continue;
                if (!isElementVisible(root)) continue;
                if (!root.querySelector?.(CREDIT_SELECTOR)) continue;
                return root;
            }
        } catch {}

        // Fallback: find the last visible credits modal root in DOM order.
        try {
            const roots = Array.from(document.querySelectorAll(CREDITS_MODAL_ROOT_SELECTOR));
            for (let i = roots.length - 1; i >= 0; i--) {
                const root = roots[i];
                if (!isElementVisible(root)) continue;
                if (!root.querySelector?.(CREDIT_SELECTOR)) continue;
                // Optional hardening: credits modal should expose the close button.
                if (!root.querySelector?.(CREDITS_CLOSE_BUTTON_SELECTOR)) continue;
                return root;
            }
        } catch {}

        return null;
    }

    function isInOpenCreditsModal(el) {
        const root = getOpenCreditsModalRoot();
        if (!root) return false;
        try {
            return root.contains(el);
        } catch {
            return false;
        }
    }

    function getCopyTargetFromEventTarget(target) {
        if (!target?.closest) return null;
        const candidate = target.closest(CREDIT_SELECTOR);
        if (!candidate) return null;
        if (!isInOpenCreditsModal(candidate)) return null;
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

    function onDocumentClick(e) {
        if (!enabled) return;
        if (e.defaultPrevented) return;
        if (e.button !== 0) return;

        const el = getCopyTargetFromEventTarget(e.target);
        if (!el) return;

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
        checkVersion();
    }

    function stop() {
        if (!running) return;
        running = false;

        setDebugValue("lastStoppedAt", new Date().toISOString());

        document.removeEventListener("click", onDocumentClick, true);
        observer?.disconnect();
        observer = undefined;
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
                    if (shouldAttemptTrackCreditsExperimentOverride()) {
                        const status = await setTrackCreditsModalExperimentDisabled().catch(() => null);
                        if (status?.failed && status?.effective !== false) {
                            showToast(`creditsClickCopy: Couldn't disable the experiment "${getTrackCreditsExperimentLabel()}". The extension may not work.`);
                        }
                    }
                    start();
                } else {
                    stop();
                    if (shouldAttemptTrackCreditsExperimentOverride()) {
                        await setTrackCreditsModalExperimentEnabled().catch(() => {});
                    }
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

    const MIN_SPOTIFY_VERSION_FOR_EXPERIMENT_OVERRIDE = "1.2.83";

    function parseMajorMinorPatch(versionLike) {
        if (!versionLike) return null;
        const m = String(versionLike).match(/(\d+)\.(\d+)\.(\d+)/);
        if (!m) return null;
        const major = Number(m[1]);
        const minor = Number(m[2]);
        const patch = Number(m[3]);
        if (![major, minor, patch].every(n => Number.isFinite(n))) return null;
        return [major, minor, patch];
    }

    function compareMajorMinorPatch(a, b) {
        for (let i = 0; i < 3; i++) {
            const diff = (a?.[i] ?? 0) - (b?.[i] ?? 0);
            if (diff !== 0) return diff;
        }
        return 0;
    }

    function getSpotifyAppVersionString() {
        // Best-effort: Spotify desktop typically includes a `Spotify/x.y.z.build` token in the UA.
        try {
            const ua = navigator.userAgent || "";
            const m = ua.match(/\bSpotify\/(\d+\.\d+\.\d+(?:\.\d+)*)\b/i);
            if (m?.[1]) return m[1];
        } catch {}

        return null;
    }

    function shouldAttemptTrackCreditsExperimentOverride() {
        const current = parseMajorMinorPatch(getSpotifyAppVersionString());
        const min = parseMajorMinorPatch(MIN_SPOTIFY_VERSION_FOR_EXPERIMENT_OVERRIDE);
        if (!min) return true;
        // If we can't detect the Spotify app version, keep existing behavior.
        if (!current) return true;
        return compareMajorMinorPatch(current, min) >= 0;
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

    function looksLikeAboutSpotifyDialogText(text) {
        if (!text) return false;

        const hasSpicetify = /spicetify/i.test(text);
        const hasSpotifyAppLine = /(spotify for windows|spotify for macos|spotify for linux)/i.test(text);
        const hasSpotifyVersionLike = /\b\d+\.\d+\.\d+\./.test(text) || /\b\d+\.\d+\.\d+\b/.test(text);

        return hasSpicetify && (hasSpotifyAppLine || hasSpotifyVersionLike);
    }

    function findAboutContainerElement() {
        const ABOUT_MODAL_CLASS_SUBSTRING = "desktopmodals-aboutSpotifyModal";

        let best = null;
        try {
            const matches = Array.from(document.querySelectorAll(`[class*="${ABOUT_MODAL_CLASS_SUBSTRING}"]`));
            for (let i = matches.length - 1; i >= 0; i--) {
                let el = matches[i];
                if (!isElementVisible(el)) continue;

                while (el?.parentElement && String(el.parentElement.className || "").includes(ABOUT_MODAL_CLASS_SUBSTRING)) {
                    el = el.parentElement;
                }

                if (!isElementVisible(el)) continue;
                best = el;
                break;
            }
        } catch {}

        return best;
    }

    function findSpicetifyRowElement(aboutRoot) {
        if (!aboutRoot?.querySelectorAll) return null;
        const nodes = aboutRoot.querySelectorAll("div, section, p, span, li, a, button");
        let best = null;
        let bestLen = Infinity;
        for (const el of nodes) {
            const text = el.textContent;
            if (!text) continue;
            if (!/spicetify/i.test(text)) continue;
            if (!(/\bv\d+\./i.test(text) || /\bspicetify\s*v\d+\./i.test(text) || /\d+\.\d+\.\d+/.test(text))) continue;
            const len = text.length;
            if (len < bestLen) {
                best = el;
                bestLen = len;
            }
        }
        return best;
    }

    function getInsertionAnchorForSpicetifyRow(spicetifyRow) {
        if (!spicetifyRow) return null;
        return (
            spicetifyRow.closest('button, [role="button"], li, [role="row"], [data-testid], section') ||
            spicetifyRow.closest('div') ||
            spicetifyRow
        );
    }

    function renderAboutDebugBlock() {
        if (!document.body) return;
        const aboutContainer = findAboutContainerElement();
        if (!aboutContainer) return;

        ensureStyle();

        let block = document.getElementById("ccc-about-debug");
        if (!block) {
            block = document.createElement("details");
            block.id = "ccc-about-debug";
            block.className = "ccc-about-debug";
            const summary = document.createElement("summary");
            summary.textContent = "creditsClickCopy (DEBUG)";
            block.appendChild(summary);

            const spicetifyRow = findSpicetifyRowElement(aboutContainer);
            const insertionAnchor = getInsertionAnchorForSpicetifyRow(spicetifyRow);
            if (insertionAnchor?.insertAdjacentElement) insertionAnchor.insertAdjacentElement("afterend", block);
            else aboutContainer.appendChild(block);
        } else {
            const spicetifyRow = findSpicetifyRowElement(aboutContainer);
            const insertionAnchor = getInsertionAnchorForSpicetifyRow(spicetifyRow);
            const desiredParent = insertionAnchor?.parentElement;
            if (desiredParent && block.parentElement !== desiredParent) {
                try { insertionAnchor.insertAdjacentElement("afterend", block); } catch {}
            }
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
        const attempt = () => {
            try { renderAboutDebugBlock(); } catch {}
        };

        let scheduled = false;
        const scheduleAttempt = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => {
                scheduled = false;
                attempt();
            }, 250);
        };

        attempt();

        try {
            const observer = new MutationObserver(() => scheduleAttempt());
            observer.observe(document.body, { childList: true, subtree: true });
        } catch {}

        const hasHistory = await waitFor(
            () => !!window.Spicetify?.Platform?.History?.listen,
            { intervalMs: 250, timeoutMs: 6000 }
        );

        if (hasHistory) {
            try {
                window.Spicetify.Platform.History.listen(() => {
                    setTimeout(attempt, 300);
                    setTimeout(attempt, 1200);
                });
            } catch {}
        }

        setInterval(attempt, 2500);
    }

    async function setTrackCreditsModalExperimentOverrideForDescription(description, desiredValue) {
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

        const target = getTrackCreditsExperimentTarget(props, description);
        if (!target?.name) return { effective: undefined, overridden: false, failed: true };

        const currentEffective = getRemoteConfigEffectiveBoolean(target);
        if (currentEffective === desiredValue) {
            return { effective: desiredValue, overridden: false, failed: false };
        }

        try {
            await api.setOverride(
                { source: "web", type: "boolean", name: target.name },
                desiredValue
            );
        } catch {
            return { effective: currentEffective, overridden: false, failed: true };
        }

        return {
            effective: currentEffective,
            overridden: true,
            failed: false,
            requiresReload: shouldReloadAfterTrackCreditsExperimentChange(currentEffective, desiredValue),
        };
    }

    function setTrackCreditsModalExperimentDisabled() {
        return Promise.all(
            TRACK_CREDITS_EXPERIMENT_DESCRIPTIONS.map(description => setTrackCreditsModalExperimentOverrideForDescription(description, false))
        );
    }

    function setTrackCreditsModalExperimentEnabled() {
        return Promise.all(
            TRACK_CREDITS_EXPERIMENT_DESCRIPTIONS.map(description => setTrackCreditsModalExperimentOverrideForDescription(description, true))
        );
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
        if (shouldAttemptTrackCreditsExperimentOverride()) {
            const expStatusList = await setTrackCreditsModalExperimentDisabled();
            const expStatus = {
                failed: expStatusList.some(status => status?.failed),
                effective: expStatusList.every(status => status?.effective === false) ? false : expStatusList.find(status => status?.effective !== undefined)?.effective,
                overridden: expStatusList.some(status => status?.overridden),
            };
            setDebugValue("lastExperimentAt", new Date().toISOString());
            setDebugValue("lastExperimentDesired", "false");
            setDebugValue("lastExperimentResult", JSON.stringify(expStatusList));
            if (expStatus?.failed && expStatus?.effective !== false) {
                showToast(`creditsClickCopy: Couldn't disable the experiment "${getTrackCreditsExperimentLabel()}". The extension may not work.`);
            }
            if (shouldReloadAfterAnyTrackCreditsExperimentChange(expStatusList)) {
                try {
                    if (!sessionStorage.getItem(TRACK_CREDITS_EXPERIMENT_RELOAD_MARKER)) {
                        sessionStorage.setItem(TRACK_CREDITS_EXPERIMENT_RELOAD_MARKER, "1");
                        location.reload();
                    }
                } catch {}
            }
        } else {
            setDebugValue("lastExperimentAt", new Date().toISOString());
            setDebugValue("lastExperimentDesired", "skipped");
            setDebugValue(
                "lastExperimentResult",
                JSON.stringify({
                    skipped: true,
                    reason: `Spotify < ${MIN_SPOTIFY_VERSION_FOR_EXPERIMENT_OVERRIDE}`,
                    spotifyVersion: getSpotifyAppVersionString()
                })
            );
        }
        start();
    } else {
        if (shouldAttemptTrackCreditsExperimentOverride()) {
            const expStatusList = await setTrackCreditsModalExperimentEnabled().catch(() => null);
            setDebugValue("lastExperimentAt", new Date().toISOString());
            setDebugValue("lastExperimentDesired", "true");
            setDebugValue("lastExperimentResult", JSON.stringify(expStatusList));
            if (shouldReloadAfterAnyTrackCreditsExperimentChange(expStatusList)) {
                try {
                    if (!sessionStorage.getItem(TRACK_CREDITS_EXPERIMENT_ENABLE_RELOAD_MARKER)) {
                        sessionStorage.setItem(TRACK_CREDITS_EXPERIMENT_ENABLE_RELOAD_MARKER, "1");
                        location.reload();
                    }
                } catch {}
            }
        } else {
            setDebugValue("lastExperimentAt", new Date().toISOString());
            setDebugValue("lastExperimentDesired", "skipped");
            setDebugValue(
                "lastExperimentResult",
                JSON.stringify({
                    skipped: true,
                    reason: `Spotify < ${MIN_SPOTIFY_VERSION_FOR_EXPERIMENT_OVERRIDE}`,
                    spotifyVersion: getSpotifyAppVersionString()
                })
            );
        }
        stop();
    }
    setupMenuToggle();
})());