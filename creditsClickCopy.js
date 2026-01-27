(() => {
    const CREDIT_SELECTOR = 'a[href*="/artist/"], a[href^="spotify:artist"], div[class*="credit" i] a, div[class*="credit" i] span';
    const VERSION_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/version.json';
    const CURRENT_VERSION = '1.1.0';

    if (!document.getElementById("credits-click-copy-style")) {
        const style = document.createElement("style");
        style.id = "credits-click-copy-style";
        style.textContent = `
            .credits-copyable {
                cursor: copy;
            }
            body.ccc-shift .credits-copyable {
                cursor: pointer;
            }
            .copied {
                opacity: 0.6;
                transition: opacity 150ms ease;
            }
            .ccc-toast {
                position: fixed;
                right: 16px;
                bottom: 16px;
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

    const DIALOG_SELECTOR = '[role="dialog"], [aria-modal="true"]';
    let shiftDown = false;

    function setShiftDown(down) {
        if (shiftDown === down) return;
        shiftDown = down;
        document.body.classList.toggle("ccc-shift", shiftDown);
    }

    function isCreditsDialog(dialogEl) {
        if (!dialogEl || dialogEl.nodeType !== 1) return false;

        const ariaLabel = dialogEl.getAttribute("aria-label") || "";
        if (/credits/i.test(ariaLabel)) return true;

        const headingEls = dialogEl.querySelectorAll('h1, h2, h3, h4, [role="heading"], header');
        for (const h of headingEls) {
            const text = (h.textContent || "").trim();
            if (/^credits$/i.test(text)) return true;
        }

        const dialogText = (dialogEl.textContent || "");
        if (!/\bcredits\b/i.test(dialogText)) return false;

        // Extra guard: Credits dialog usually contains role labels.
        if (/(written by|produced by|performed by|source)/i.test(dialogText)) return true;

        return false;
    }

    function getCreditsDialogFromNode(node) {
        const dialogEl = node?.closest?.(DIALOG_SELECTOR);
        if (!dialogEl) return null;
        return isCreditsDialog(dialogEl) ? dialogEl : null;
    }

    function getCopyTargetFromEventTarget(target) {
        if (!target?.closest) return null;
        const candidate = target.closest(CREDIT_SELECTOR);
        if (!candidate) return null;
        const creditsDialog = getCreditsDialogFromNode(candidate);
        if (!creditsDialog) return null;
        return candidate;
    }

    document.addEventListener(
        "keydown",
        e => {
            if (e.key === "Shift" || e.code === "ShiftLeft" || e.code === "ShiftRight") setShiftDown(true);
        },
        true
    );

    document.addEventListener(
        "keyup",
        e => {
            if (e.key === "Shift" || e.code === "ShiftLeft" || e.code === "ShiftRight") setShiftDown(false);
        },
        true
    );

    window.addEventListener("blur", () => setShiftDown(false));

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

    function hookCreditsDialog(dialogEl) {
        dialogEl.querySelectorAll(CREDIT_SELECTOR).forEach(mark);
    }

    function hookAllOpenCreditsDialogs() {
        document.querySelectorAll(DIALOG_SELECTOR).forEach(d => {
            if (isCreditsDialog(d)) hookCreditsDialog(d);
        });
    }

    function onDocumentClick(e) {
        if (e.defaultPrevented) return;
        if (e.button !== 0) return;

        const el = getCopyTargetFromEventTarget(e.target);
        if (!el || !el.dataset.copyHooked) return;

        // Normal Spotify behaviour mode (hold Shift)
        if (e.shiftKey || shiftDown) return;

        e.preventDefault();
        e.stopPropagation();

        const text = el.textContent?.trim();
        if (!text) return;

        copyText(text);

        el.classList.add("copied");
        setTimeout(() => el.classList.remove("copied"), 150);
    }

    // Capture so we can prevent navigation when copying.
    document.addEventListener("click", onDocumentClick, true);

    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;

                // Only hook inside Credits dialogs (prevents leaking to other popups/menus).
                if (node.matches?.(DIALOG_SELECTOR) && isCreditsDialog(node)) {
                    hookCreditsDialog(node);
                    continue;
                }

                const possibleDialogs = node.querySelectorAll?.(DIALOG_SELECTOR);
                if (possibleDialogs?.length) {
                    for (const d of possibleDialogs) {
                        if (isCreditsDialog(d)) hookCreditsDialog(d);
                    }
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Initial hook for already-open Credits dialog.
    hookAllOpenCreditsDialogs();

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
                    showToast("Credits Click Copy: You are not on the latest version!");
                }
            })
            .catch(() => {});
    }

    checkVersion();
})();
