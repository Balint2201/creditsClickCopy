(() => {
    // Scope everything to the Credits modal to avoid intercepting clicks globally.
    // Spotify XPUI markup changes over versions, so we match multiple non-language signals.
    const CREDITS_MODAL_SELECTORS = [
        ".main-trackCreditsModal-container", // legacy
        "[class*='trackCreditsModal' i]", // newer/alternative naming
        "[data-testid*='credits' i][role='dialog']",
        "[data-testid*='credits' i][aria-modal='true']"
    ];

    const INTERACTIVE_TARGET_SELECTOR = "a[href], button, [role='link'], [role='button']";
    const LEGACY_CREDIT_TARGET_SELECTOR = "div[class*='credit' i] a, div[class*='credit' i] span";
    const VERSION_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/version.json';
    const CURRENT_VERSION = '1.3.0';
    const STORAGE_KEY_ENABLED = "creditsClickCopy:enabled";

    let enabled = true;
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

    function queryFirst(selectorList, root = document) {
        for (const sel of selectorList) {
            const found = root.querySelector(sel);
            if (found) return found;
        }
        return null;
    }

    function closestFirst(target, selectorList) {
        if (!target?.closest) return null;
        for (const sel of selectorList) {
            const found = target.closest(sel);
            if (found) return found;
        }
        return null;
    }

    function getCreditsModalRootFromTarget(target) {
        return closestFirst(target, CREDITS_MODAL_SELECTORS);
    }

    function getCreditsModalRootFromDocument() {
        return queryFirst(CREDITS_MODAL_SELECTORS, document);
    }

    function getCopyableText(el) {
        const text = el?.textContent?.trim?.();
        if (!text) return "";
        if (/[\r\n\t]/.test(text)) return "";
        if (text.length > 120) return "";
        // Avoid copying icon-only buttons/links.
        if (!/[\p{L}\p{N}]/u.test(text)) return "";
        return text;
    }

    function getCopyTargetFromEventTarget(target) {
        if (!target?.closest) return null;

        const modalRoot = getCreditsModalRootFromTarget(target);
        if (!modalRoot) return null;

        // Prefer interactive elements first (more stable across markup changes).
        const interactive = target.closest(INTERACTIVE_TARGET_SELECTOR);
        if (interactive && modalRoot.contains(interactive) && getCopyableText(interactive)) return interactive;

        // Fallback to legacy credit-class-based targeting.
        const legacy = target.closest(LEGACY_CREDIT_TARGET_SELECTOR);
        if (legacy && modalRoot.contains(legacy) && getCopyableText(legacy)) return legacy;

        return null;
    }

    function copyText(text) {
        // Spotify/Spicetify internal clipboard is usually the most reliable in newer builds.
        try {
            const clipboardApi = window.Spicetify?.Platform?.ClipboardAPI;
            if (clipboardApi?.copy) {
                const res = clipboardApi.copy(text);
                if (res?.then) {
                    return res.catch(() => {
                        // fall through to web clipboard below
                        throw new Error("ClipboardAPI.copy failed");
                    });
                }
                return Promise.resolve();
            }
        } catch {}

        return navigator.clipboard.writeText(text).catch(() => {
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
        const modalRoot = getCreditsModalRootFromDocument();
        if (!modalRoot) return;
        // Mark likely copy targets inside Credits modal.
        modalRoot.querySelectorAll(`${INTERACTIVE_TARGET_SELECTOR}, ${LEGACY_CREDIT_TARGET_SELECTOR}`).forEach(el => {
            if (getCopyableText(el)) mark(el);
        });
    }

    function onDocumentClick(e) {
        if (!enabled) return;
        if (e.defaultPrevented) return;
        if (e.button !== 0) return;

        // Don't capture clicks unless a Credits modal is present.
        if (!getCreditsModalRootFromDocument()) return;

        const el = getCopyTargetFromEventTarget(e.target);
        if (!el) return;
        mark(el);

        e.preventDefault();
        e.stopPropagation();

        const text = getCopyableText(el);
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

                    // Only process nodes when a Credits modal exists.
                    const modalRoot = getCreditsModalRootFromDocument();
                    if (!modalRoot) continue;

                    // Mark any new potential targets inside the Credits modal.
                    if (modalRoot.contains(node)) {
                        if (node.matches?.(`${INTERACTIVE_TARGET_SELECTOR}, ${LEGACY_CREDIT_TARGET_SELECTOR}`) && getCopyableText(node)) {
                            mark(node);
                        }
                        node.querySelectorAll?.(`${INTERACTIVE_TARGET_SELECTOR}, ${LEGACY_CREDIT_TARGET_SELECTOR}`).forEach((el) => {
                            if (getCopyableText(el)) mark(el);
                        });
                    }
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

    function showToast(text) {
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
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => {
            el.classList.remove("show");
            setTimeout(() => el.remove(), 200);
        }, 4500);
    }

    function checkVersion() {
        fetch(VERSION_URL, { cache: "no-store" })
            .then(r => r.ok ? r.json() : null)
            .then(json => {
                if (!json || !json.version) return;
                if (String(json.version) !== String(CURRENT_VERSION)) {
                    showToast(`creditsClickCopy: You are not on the latest version! Latest version: v${json.version}`);
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
            (self) => {
                const next = !self.isEnabled;
                self.setState(next);

                enabled = next;
                setStoredEnabled(enabled);

                if (enabled) start();
                else stop();

                try {
                    window.Spicetify?.showNotification?.(`creditsClickCopy ${enabled ? "enabled" : "disabled"}`);
                } catch {}
            }
        );

        menuItem.register();
    }

    enabled = getStoredEnabled();
    if (enabled) start();
    else stop();
    setupMenuToggle();
})();
