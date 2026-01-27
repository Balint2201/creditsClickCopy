(() => {
    const CREDIT_SELECTOR = 'div[class*="credit" i] span, div[class*="credit" i] a';

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
        `;
        document.head.appendChild(style);
    }

    let shiftDown = false;

    function setShiftDown(down) {
        if (shiftDown === down) return;
        shiftDown = down;
        if (shiftDown) {
            document.body.classList.add("ccc-shift");
        } else {
            document.body.classList.remove("ccc-shift");
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

    document.addEventListener("click", e => {
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
    });

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
})();
