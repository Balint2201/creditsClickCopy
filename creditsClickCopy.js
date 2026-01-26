(function () {
    function copyText(text) {
        navigator.clipboard.writeText(text).catch(() => {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            textarea.remove();
        });
    }

    function hookCredits() {
        const observer = new MutationObserver(() => {
            document.querySelectorAll(
                'div[class*="credits"] span, div[class*="Credits"] span, div[class*="credits"] a, div[class*="Credits"] a'
            ).forEach(el => {
                if (el.dataset.copyHooked) return;

                el.dataset.copyHooked = "true";
                el.style.cursor = "copy";

                el.addEventListener("click", e => {
                    e.stopPropagation();
                    e.preventDefault();

                    const text = el.textContent.trim();
                    if (!text) return;

                    copyText(text);

                    el.style.opacity = "0.6";
                    setTimeout(() => el.style.opacity = "1", 150);
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    hookCredits();
})();

