(async () => {
    const rawUrl = "https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/creditsClickCopy.js";
    const cdnUrl = "https://cdn.jsdelivr.net/gh/Balint2201/creditsClickCopy@main/creditsClickCopy.js";

    async function loadScript(url) {
        const res = await fetch(url + "?t=" + Date.now());
        if (!res.ok) throw new Error("fetch fail: " + res.status);
        const code = await res.text();
        const script = document.createElement("script");
        script.textContent = code;
        document.head.appendChild(script);
    }

    try {
        await loadScript(rawUrl);
        console.log("[creditsClickCopy] Loaded from GitHub raw.");
    } catch (err) {
        console.warn("[creditsClickCopy] Raw load failed, trying jsDelivr…", err);
        try {
            await loadScript(cdnUrl);
            console.log("[creditsClickCopy] Loaded from jsDelivr fallback.");
        } catch (cdnErr) {
            console.error("[creditsClickCopy] jsDelivr fallback failed too:", cdnErr);
        }
    }
})();
