(() => {
    let clickEnabled = false;
    const CREDIT_SELECTOR = 'div[class*="credit" i] span, div[class*="credit" i] a';
    const VERSION_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/version.json';
    const CURRENT_VERSION = '1.0.1';

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

    let shiftDown = false;

    function setShiftDown(down) {
        if (shiftDown === down) return;
        shiftDown = down;
        if (shiftDown) {
            document.body.classList.add("ccc-shift");
            if (clickEnabled) {
                document.removeEventListener("click", onDocumentClick);
                clickEnabled = false;
            }
        } else {
            document.body.classList.remove("ccc-shift");
            if (!clickEnabled) {
                document.addEventListener("click", onDocumentClick);
                clickEnabled = true;
            }
        }
    }

    document.addEventListener(
        "keydown",
        e => {
            if (e.code === "ShiftLeft" || e.code === "ShiftRight") setShiftDown(true);
        },
        true
    );

    document.addEventListener("keyup", e => {
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") setShiftDown(false);
    });

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

    document.querySelectorAll(CREDIT_SELECTOR).forEach(mark);

    function onDocumentClick(e) {
        const el = e.target.closest(CREDIT_SELECTOR);
        if (!el || !el.dataset.copyHooked) return;

        if (shiftDown || e.shiftKey) return;

        e.preventDefault();
        e.stopPropagation();

        const text = el.textContent?.trim();
        if (!text) return;

        copyText(text);

        el.classList.add("copied");
        setTimeout(() => el.classList.remove("copied"), 150);
    }

    if (!shiftDown && !clickEnabled) {
        document.addEventListener("click", onDocumentClick);
        clickEnabled = true;
    }

    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;

                if (node.matches?.(CREDIT_SELECTOR)) {
                    mark(node);
                }

                node.querySelectorAll?.(CREDIT_SELECTOR).forEach(mark);
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

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
