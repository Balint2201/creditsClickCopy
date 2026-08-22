(async () => {
    const SOURCES = [
        { name: "GitHub raw", url: "https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/creditsClickCopy.js" },
        { name: "jsDelivr", url: "https://cdn.jsdelivr.net/gh/Balint2201/creditsClickCopy@main/creditsClickCopy.js" },
    ];

    const FETCH_TIMEOUT_MS = 10000;
    const SPICETIFY_TIMEOUT_MS = 15000;

    /** Spicetify can run extensions before Platform exists; the extension reads it on load. */
    async function waitForSpicetify() {
        const deadline = Date.now() + SPICETIFY_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (window.Spicetify?.Platform && window.Spicetify?.LocalStorage) return true;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    }

    async function fetchSource(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const code = await response.text();
            if (!code.trim()) throw new Error("empty response");
            return code;
        } finally {
            clearTimeout(timer);
        }
    }

    function evaluate(code) {
        // The sourceURL keeps the file addressable in DevTools instead of showing up
        // as an anonymous <script>.
        const source = `${code}\n//# sourceURL=creditsClickCopy.js`;
        const script = document.createElement("script");
        script.textContent = source;
        (document.head || document.documentElement).appendChild(script);
        script.remove();

        if (!window.creditsClickCopy) throw new Error("script ran but did not register window.creditsClickCopy");
    }

    await waitForSpicetify();

    for (const source of SOURCES) {
        try {
            evaluate(await fetchSource(source.url));
            console.log(`[creditsClickCopy] Loaded from ${source.name}.`);
            return;
        } catch (error) {
            console.warn(`[creditsClickCopy] ${source.name} failed:`, error);
        }
    }

    console.error("[creditsClickCopy] Every source failed — the extension is not running.");
})();
