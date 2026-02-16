((async () => {
    const CREDIT_SELECTOR = 'div[class*="credit" i] a, div[class*="credit" i] span';
    const VERSION_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/version.json';
    const GLOBAL_SWITCH_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/globalswitch.json';
    const CURRENT_VERSION = '1.4.1';
    const STORAGE_KEY_ENABLED = "creditsClickCopy:enabled";
    const TRACK_CREDITS_EXPERIMENT_DESCRIPTION = "Enables the new TrackCreditsModal implementation";
    const TRACK_CREDITS_EXPERIMENT_RELOAD_MARKER = "creditsClickCopy:reloadedAfterDisablingTrackCreditsModal";
    const TRACK_CREDITS_EXPERIMENT_ENABLE_RELOAD_MARKER = "creditsClickCopy:reloadedAfterEnablingTrackCreditsModal";
    const DEFAULT_POPUP_LENGTH_MS = 4500;

    let enabled = true;
    let enabledGlobally = true;
    let popupLengthMs = DEFAULT_POPUP_LENGTH_MS;
    let running = false;
    let observer;

    if (!document.getElementById("credits-click-copy-style")) {
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

        document.removeEventListener("click", onDocumentClick, true);
        observer?.disconnect();
        observer = undefined;

        unmarkAll();
    }

    function showToast(text, durationMs = popupLengthMs) {
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

    enabled = getStoredEnabled();

    const globalSwitch = await getGlobalSwitch();
    if (globalSwitch?.popuplenght !== undefined) popupLengthMs = globalSwitch.popuplenght;

    if (globalSwitch && globalSwitch.enabled_globally === false) {
        enabledGlobally = false;
        showToast(`creditsClickCopy: Extension disabled globally, reason: ${globalSwitch.message}`);
        stop();
        setupMenuToggle();
        return;
    }

    if (enabled) {
        const expStatus = await setTrackCreditsModalExperimentDisabled();
        if (expStatus?.failed && expStatus?.effective !== false) {
            showToast(`creditsClickCopy: Couldn't disable the experiment "${TRACK_CREDITS_EXPERIMENT_DESCRIPTION}". The extension may not work.`);
        }
        start();
    } else {
        await setTrackCreditsModalExperimentEnabled().catch(() => {});
        stop();
    }
    setupMenuToggle();
})());