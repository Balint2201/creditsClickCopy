(() => {
    "use strict";

    /* ------------------------------------------------------------------ *
     * Configuration
     * ------------------------------------------------------------------ */

    // Version
    const CURRENT_VERSION = '2.0.0';

    const VERSION_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/version.json';
    const GLOBAL_SWITCH_URL = 'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/globalswitch.json';

    // Same two sources the installed loader uses, so reloading in place is exactly
    // what a Spotify restart would fetch.
    const SOURCE_URLS = [
        'https://raw.githubusercontent.com/Balint2201/creditsClickCopy/refs/heads/main/creditsClickCopy.js',
        'https://cdn.jsdelivr.net/gh/Balint2201/creditsClickCopy@main/creditsClickCopy.js',
    ];

    const STORAGE_KEY_ENABLED = "creditsClickCopy:enabled";
    const LEGACY_DEBUG_KEY_PREFIX = "creditsClickCopy:debug:";
    const LEGACY_RELOAD_MARKERS = [
        "creditsClickCopy:reloadedAfterDisablingTrackCreditsModal",
        "creditsClickCopy:reloadedAfterEnablingTrackCreditsModal",
    ];

    const DEFAULT_POPUP_LENGTH_MS = 4500;
    const REMOTE_FETCH_TIMEOUT_MS = 8000;
    const RESCAN_DEBOUNCE_MS = 150;
    const COPY_FLASH_MS = 220;
    const MAX_COPY_LENGTH = 600;

    // Locale keys Spotify itself uses for these dialogs. Resolving them through
    // Spicetify.Locale keeps detection language-independent.
    const CREDITS_LABEL_KEY = "track-credits.label";
    const ABOUT_LABEL_KEY = "about.title_label";

    // Spotify's modals are native <dialog> elements and carry no role attribute, so
    // matching on [role="dialog"] alone finds nothing.
    const DIALOG_SELECTOR = 'dialog, [role="dialog"]';

    // Spotify's "report an error" link, identical in every locale and present in both
    // of the newer Credits modals.
    const CREDITS_HELP_URL_FRAGMENT = "article/song-credits";

    // Only used when Spicetify.Locale is unavailable.
    const CREDITS_LABEL_FALLBACKS = ["credits", "közreműködők", "créditos", "crédits", "crediti", "titelinfo", "credits-info"];

    /* ------------------------------------------------------------------ *
     * Tear down a previously injected instance (hot reload / re-inject)
     * ------------------------------------------------------------------ */

    try { window.creditsClickCopy?.destroy?.(); } catch { /* previous instance already gone */ }

    /* ------------------------------------------------------------------ *
     * State
     * ------------------------------------------------------------------ */

    const state = {
        enabled: true,
        enabledGlobally: true,
        popupLengthMs: DEFAULT_POPUP_LENGTH_MS,
        installed: false,
    };

    const debugInfo = {
        loadedAt: new Date().toISOString(),
        latestVersion: null,
        versionCheckedAt: null,
        globalSwitchFetchedAt: null,
        globalSwitchMessage: "",
        creditsVariant: "(not seen yet)",
        detectionTier: "(not seen yet)",
        lastCopiedText: null,
        lastCopiedAt: null,
        clipboardPath: "(nothing copied yet)",
        lastError: null,
    };

    /** Everything registered here runs on destroy(). */
    const disposers = [];
    const onDestroy = fn => { disposers.push(fn); };

    /* ------------------------------------------------------------------ *
     * Small helpers
     * ------------------------------------------------------------------ */

    const log = (...args) => console.log("[creditsClickCopy]", ...args);
    const warn = (...args) => console.warn("[creditsClickCopy]", ...args);

    function recordError(where, error) {
        debugInfo.lastError = `${where}: ${error?.message || error}`;
        warn(where, error);
    }

    /**
     * Deliberately ignores opacity: Spotify fades dialogs in, and a dialog stuck at
     * opacity 0 behind another one is still the dialog we want to find. Closed dialogs
     * are unmounted entirely, so client rects are the reliable signal.
     */
    function isVisible(el) {
        if (!el || el.nodeType !== 1) return false;
        try {
            if (el.getClientRects().length === 0) return false;
            const style = getComputedStyle(el);
            return style.display !== "none" && style.visibility !== "hidden";
        } catch {
            return false;
        }
    }

    function debounce(fn, ms) {
        let timer = 0;
        const wrapped = (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
        wrapped.cancel = () => clearTimeout(timer);
        return wrapped;
    }

    /** Matches Encore's hashed class prefix: `legacy-list-row` -> `e-10451-legacy-list-row`. */
    function hasEncoreClass(el, base) {
        const raw = el?.getAttribute?.("class");
        if (!raw) return false;
        return raw.split(/\s+/).some(cls => cls === base || (cls.startsWith("e-") && cls.endsWith(`-${base}`)));
    }

    function localized(key) {
        try {
            const value = window.Spicetify?.Locale?.get?.(key);
            if (typeof value === "string" && value.trim() && value.trim() !== key) return value.trim();
        } catch { /* Locale not ready */ }
        return null;
    }

    /**
     * Characters Spotify uses to join several names into one element. The locale
     * separator matters: CJK locales join with U+3001, not a comma.
     */
    function separatorPattern() {
        const chars = new Set([",", ";", "·", "•", "/"]);
        try {
            const sep = window.Spicetify?.Locale?.getSeparator?.();
            if (typeof sep === "string") for (const ch of sep.trim()) chars.add(ch);
        } catch { /* Locale not ready */ }

        const escaped = [...chars].map(ch => ch.replace(/[\\\]^-]/g, "\\$&")).join("");
        return new RegExp("\\s*[" + escaped + "]\\s*", "g");
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
        try { window.Spicetify?.LocalStorage?.set?.(STORAGE_KEY_ENABLED, serialized); } catch { /* ignore */ }
        try { localStorage.setItem(STORAGE_KEY_ENABLED, serialized); } catch { /* ignore */ }
    }

    /** 1.5.x persisted debug rows and reload markers. Nothing reads them any more. */
    function cleanUpLegacyStorage() {
        try {
            const stale = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith(LEGACY_DEBUG_KEY_PREFIX)) stale.push(key);
            }
            stale.forEach(key => localStorage.removeItem(key));
        } catch { /* ignore */ }
        for (const marker of LEGACY_RELOAD_MARKERS) {
            try { sessionStorage.removeItem(marker); } catch { /* ignore */ }
        }
    }

    async function fetchText(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            if (!text.trim()) throw new Error("empty response");
            return text;
        } finally {
            clearTimeout(timer);
        }
    }

    async function fetchJson(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    }

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    const STYLE_ID = "credits-click-copy-style";

    function installStyles() {
        document.getElementById(STYLE_ID)?.remove();

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            /* The copy cursor marks exactly what a click would copy: the track title
               and the credited names. Headings, role labels and the sources row keep
               the normal cursor. */
            [data-ccc-credits],
            [data-ccc-credits] * {
                cursor: default;
            }

            [data-ccc-credits] h2,
            [data-ccc-credits] [data-encore-id="listRow"],
            [data-ccc-credits] [data-encore-id="listRow"] *,
            [data-ccc-credits] [class*="trackCreditsModal-sectionTitle" i] > * {
                cursor: copy;
            }

            [data-ccc-credits] [data-encore-id="listRowDetails"],
            [data-ccc-credits] [data-encore-id="listRowDetails"] *,
            [data-ccc-credits] [class*="legacy-list-row-details"],
            [data-ccc-credits] [class*="legacy-list-row-details"] *,
            [data-ccc-credits] [aria-labelledby="listrow-title-sources"],
            [data-ccc-credits] [aria-labelledby="listrow-title-sources"] *,
            [data-ccc-credits] [class*="trackCreditsModal-sectionTitle" i] > *:first-child {
                cursor: default;
            }

            /* Real buttons stay buttons: close, follow, "report an error". */
            [data-ccc-credits] button,
            [data-ccc-credits] button *,
            [data-ccc-credits] [data-encore-id^="button"],
            [data-ccc-credits] [data-encore-id^="button"] * {
                cursor: pointer;
            }

            .ccc-copied {
                opacity: 0.55;
                transition: opacity ${COPY_FLASH_MS}ms ease;
            }

            .ccc-toast {
                position: fixed;
                right: 16px;
                bottom: 72px;
                max-width: 420px;
                background: rgba(0, 0, 0, 0.88);
                color: #fff;
                border-radius: 8px;
                padding: 10px 12px;
                font-size: 13px;
                line-height: 1.4;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
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

            .ccc-about-debug .ccc-row {
                display: flex;
                gap: 10px;
                margin: 4px 0;
                flex-wrap: wrap;
            }

            .ccc-about-debug .ccc-key {
                font-weight: 600;
            }

            .ccc-about-debug .ccc-value {
                opacity: 0.9;
                word-break: break-word;
            }

            .ccc-about-debug .ccc-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 14px;
            }

            .ccc-about-debug .ccc-btn {
                appearance: none;
                display: inline-flex;
                align-items: center;
                gap: 7px;
                min-height: 32px;
                padding: 0 14px;
                border-radius: 999px;
                /* --decorative-subdued is near-black on the dark modal, so it would
                   read as no border at all. */
                border: 1px solid var(--text-subdued, rgba(255, 255, 255, 0.35));
                background: transparent;
                color: var(--text-base, #fff);
                font-family: inherit;
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 0.02em;
                white-space: nowrap;
                cursor: pointer;
                transition:
                    background-color 130ms ease,
                    border-color 130ms ease,
                    color 130ms ease,
                    transform 130ms ease,
                    opacity 130ms ease;
            }

            .ccc-about-debug .ccc-btn svg {
                width: 14px;
                height: 14px;
                flex: 0 0 auto;
                fill: currentColor;
                transition: transform 400ms ease;
            }

            .ccc-about-debug .ccc-btn:hover:not(:disabled) {
                background: var(--background-tinted-highlight, rgba(255, 255, 255, 0.1));
                border-color: var(--text-base, #fff);
                transform: scale(1.03);
            }

            .ccc-about-debug .ccc-btn:active:not(:disabled) {
                transform: scale(0.97);
                background: var(--background-tinted-press, rgba(255, 255, 255, 0.04));
            }

            .ccc-about-debug .ccc-btn:focus-visible {
                outline: 2px solid var(--essential-bright-accent, #1ed760);
                outline-offset: 2px;
            }

            /* The reload button leans on Spotify green, and its arrow spins on hover. */
            .ccc-about-debug .ccc-btn[data-variant="accent"]:hover:not(:disabled) {
                color: var(--essential-bright-accent, #1ed760);
                border-color: var(--essential-bright-accent, #1ed760);
            }

            .ccc-about-debug .ccc-btn[data-variant="accent"]:hover:not(:disabled) svg {
                transform: rotate(180deg);
            }

            .ccc-about-debug .ccc-btn.is-done {
                color: var(--essential-bright-accent, #1ed760);
                border-color: var(--essential-bright-accent, #1ed760);
            }

            .ccc-about-debug .ccc-btn:disabled {
                opacity: 0.55;
                cursor: default;
            }

            .ccc-about-debug .ccc-btn.is-busy svg {
                animation: ccc-spin 800ms linear infinite;
            }

            @keyframes ccc-spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        onDestroy(() => style.remove());
    }

    /* ------------------------------------------------------------------ *
     * Toast
     * ------------------------------------------------------------------ */

    let toastEl = null;
    let toastTimer = 0;

    function showToast(text, durationMs = state.popupLengthMs) {
        if (!document.body) return;

        if (!toastEl || !toastEl.isConnected) {
            toastEl = document.createElement("div");
            toastEl.className = "ccc-toast";
            document.body.appendChild(toastEl);
        }

        toastEl.textContent = text;
        requestAnimationFrame(() => toastEl?.classList.add("show"));

        const duration = Number.isFinite(durationMs) ? Math.max(500, durationMs) : DEFAULT_POPUP_LENGTH_MS;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastEl?.classList.remove("show");
            setTimeout(() => {
                toastEl?.remove();
                toastEl = null;
            }, 250);
        }, duration);
    }

    /* ------------------------------------------------------------------ *
     * Clipboard
     * ------------------------------------------------------------------ */

    async function copyText(text) {
        // Spicetify's platform API is the most reliable inside Spotify's CEF shell:
        // it needs neither document focus nor a permission grant.
        try {
            const clipboard = window.Spicetify?.Platform?.ClipboardAPI;
            if (clipboard?.copy) {
                await clipboard.copy(text);
                debugInfo.clipboardPath = "Spicetify.Platform.ClipboardAPI";
                return true;
            }
        } catch (error) {
            debugInfo.lastError = `clipboard (spicetify): ${error?.message || error}`;
        }

        try {
            await navigator.clipboard.writeText(text);
            debugInfo.clipboardPath = "navigator.clipboard";
            return true;
        } catch (error) {
            debugInfo.lastError = `clipboard (navigator): ${error?.message || error}`;
        }

        try {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.top = "-1000px";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            const ok = document.execCommand("copy");
            textarea.remove();
            debugInfo.clipboardPath = ok ? "execCommand" : "(all methods failed)";
            return ok;
        } catch (error) {
            recordError("clipboard", error);
            return false;
        }
    }

    /* ------------------------------------------------------------------ *
     * Credits modal detection
     *
     * Three tiers, cheapest and most specific first. Only class-name substrings
     * that Spotify derives from component names are used — never a full hashed
     * class, which changes on every release.
     * ------------------------------------------------------------------ */

    function creditsLabelMatches(value) {
        if (!value) return false;
        const label = localized(CREDITS_LABEL_KEY);
        const normalized = value.trim().toLowerCase();
        if (label) return normalized === label.toLowerCase();
        return CREDITS_LABEL_FALLBACKS.includes(normalized);
    }

    function found(root, tier, variant) {
        debugInfo.detectionTier = tier;
        debugInfo.creditsVariant = variant;
        return root;
    }

    function findCreditsRoot() {
        // Tier 1: the classic and modalV2 containers keep a component-derived class name.
        const containers = Array.from(document.querySelectorAll('[class*="trackCreditsModal"]')).filter(isVisible);
        const outermost = containers.find(el => !containers.some(other => other !== el && other.contains(el)));
        if (outermost) {
            const isV2 = /trackCreditsModalV2/i.test(outermost.getAttribute("class") || "");
            return found(outermost, "container class", isV2 ? "modalV2" : "classic");
        }

        // Tier 2: the listRows variant has hashed container classes but keeps test ids.
        const testIdRow = document.querySelector('[data-testid="credits-artist-row"]');
        if (testIdRow && isVisible(testIdRow)) {
            const root = testIdRow.closest(DIALOG_SELECTOR) || testIdRow.parentElement;
            if (root) return found(root, "credits-artist-row test id", "listRows");
        }

        // Tier 3: every non-classic credits modal links to Spotify's song-credits help
        // article. The URL is the same in every language, which makes this the one
        // signal that survives both a UI rewrite and a locale we know nothing about.
        for (const link of document.querySelectorAll(`a[href*="${CREDITS_HELP_URL_FRAGMENT}"]`)) {
            const root = link.closest(DIALOG_SELECTOR);
            if (root && isVisible(root)) return found(root, "song-credits help link", "unrecognised");
        }

        // Tier 4: the dialog's aria-label is Spotify's own localized "Credits" string.
        // Spicetify.Locale is missing in some builds, hence the word list fallback.
        const dialogs = Array.from(document.querySelectorAll(DIALOG_SELECTOR));
        for (let i = dialogs.length - 1; i >= 0; i--) {
            const dialog = dialogs[i];
            if (!isVisible(dialog)) continue;
            if (!creditsLabelMatches(dialog.getAttribute("aria-label"))) continue;
            return found(dialog, "dialog aria-label", "unrecognised");
        }

        return null;
    }

    /* ------------------------------------------------------------------ *
     * Copy target resolution
     * ------------------------------------------------------------------ */

    // Anything the user clicked here is a control, not a credit — leave it alone.
    const HANDS_OFF_SELECTOR = 'button, [data-encore-id^="button"], [class*="closeBtn" i], input, textarea, select';

    function closestListRow(el) {
        const byEncoreId = el.closest('[data-encore-id="listRow"]');
        if (byEncoreId) return byEncoreId;

        for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
            if (hasEncoreClass(node, "legacy-list-row")) return node;
        }
        return null;
    }

    /** The smallest element that owns this text — i.e. no element child carries text of its own. */
    function textLeaf(el) {
        const text = (el.textContent || "").trim();
        if (!text || text.length > MAX_COPY_LENGTH) return null;
        for (const child of el.children) {
            if ((child.textContent || "").trim()) return null;
        }
        return el;
    }

    function rowTitleElement(row) {
        const explicit = row.querySelector('[data-encore-id="listRowTitle"], [id^="listrow-title-"]');
        if (explicit) return explicit;

        // Encore renders a supplied title element verbatim, so the name is simply the
        // first text-bearing child of the row's text column that isn't the subtitle.
        const column = Array.from(row.querySelectorAll("div")).find(div => hasEncoreClass(div, "legacy-list-row__column"));
        for (const child of column?.children || []) {
            if (child.matches('[data-encore-id="listRowDetails"]') || hasEncoreClass(child, "legacy-list-row-details")) continue;
            if ((child.textContent || "").trim()) return child;
        }
        return null;
    }

    /**
     * The "Sources" row is a ListRow like any credit, but it names a data provider
     * rather than a person. Encore builds the row's aria-labelledby from the id
     * Spotify passes, which is the literal string "sources" for that one row.
     */
    function isSourcesRow(row) {
        return (row.getAttribute("aria-labelledby") || "").trim() === "listrow-title-sources";
    }

    /** The ancestor of `el` that is a direct child of `container`. */
    function directChildOf(container, el) {
        let node = el;
        while (node && node.parentElement && node.parentElement !== container) node = node.parentElement;
        return node?.parentElement === container ? node : null;
    }

    /**
     * Only the track title and the credited names are worth copying. Role labels
     * ("Written by", "Composer • Producer"), section headings ("Credits",
     * "Additional credits", role group titles) and the sources row are all skipped,
     * in every one of the three modal variants.
     */
    function isCopyableCredit(el) {
        const row = closestListRow(el);
        if (row) {
            if (isSourcesRow(row)) return false;
            // The roles live in the row's subtitle slot.
            if (el.closest('[data-encore-id="listRowDetails"]')) return false;
            for (let node = el; node && node !== row; node = node.parentElement) {
                if (hasEncoreClass(node, "legacy-list-row-details")) return false;
            }
            return true;
        }

        // classic: <div sectionTitle> holds the role label first, then the names.
        const section = el.closest('[class*="trackCreditsModal-sectionTitle" i]');
        if (section) return section.firstElementChild !== directChildOf(section, el);

        // Everything else loose in the modal is a heading — except the <h2>, which is
        // the track title in all three variants.
        return el.tagName === "H2";
    }

    function resolveCopyTarget(event, root) {
        const candidates = [];

        // Hit-test the point rather than trusting event.target: on the ListRow-based
        // variants an invisible click overlay is painted on top of every name.
        if (typeof document.elementsFromPoint === "function" && Number.isFinite(event.clientX)) {
            candidates.push(...document.elementsFromPoint(event.clientX, event.clientY));
        }
        if (event.target instanceof Element) candidates.push(event.target);

        for (const candidate of candidates) {
            if (!(candidate instanceof Element) || !root.contains(candidate)) continue;
            if (candidate.closest(HANDS_OFF_SELECTOR)) return null;
            const leaf = textLeaf(candidate);
            if (!leaf) continue;
            return isCopyableCredit(leaf) ? leaf : null;
        }

        // Nothing readable under the cursor (clicked the padding of a row) — fall back
        // to the row's own title so the click still copies the name.
        if (event.target instanceof Element) {
            const row = closestListRow(event.target);
            if (row && root.contains(row) && !isSourcesRow(row) && !event.target.closest(HANDS_OFF_SELECTOR)) {
                return rowTitleElement(row);
            }
        }

        return null;
    }

    /* ------------------------------------------------------------------ *
     * Picking the clicked name out of a joined list
     *
     * "Alice, Bob, Carol" in one element should copy just the name under the
     * cursor, and "Source: SoundBetter" should copy either side of the colon.
     * ------------------------------------------------------------------ */

    function caretOffsetIn(el, x, y) {
        let node = null;
        let offset = 0;

        try {
            if (typeof document.caretPositionFromPoint === "function") {
                const position = document.caretPositionFromPoint(x, y);
                if (position) { node = position.offsetNode; offset = position.offset; }
            } else if (typeof document.caretRangeFromPoint === "function") {
                const range = document.caretRangeFromPoint(x, y);
                if (range) { node = range.startContainer; offset = range.startOffset; }
            }
        } catch { /* ignore */ }

        if (!node || !el.contains(node)) return null;

        // Translate the offset inside one text node into an offset inside el.textContent.
        let total = 0;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let current = walker.nextNode(); current; current = walker.nextNode()) {
            if (current === node) return total + offset;
            total += current.nodeValue.length;
        }
        return null;
    }

    function segmentAt(raw, offset) {
        const separator = separatorPattern();
        let start = 0;
        let match;

        while ((match = separator.exec(raw)) !== null) {
            const sepStart = match.index;
            const sepEnd = sepStart + match[0].length;
            if (offset < sepEnd) return { text: raw.slice(start, sepStart), start };
            start = sepEnd;
        }
        return { text: raw.slice(start), start };
    }

    /** "Source: SoundBetter" -> the side of the colon the cursor is on. */
    function splitAtColon(text, relativeOffset) {
        const colon = text.indexOf(":");
        if (colon <= 0 || colon === text.length - 1) return text;
        return relativeOffset > colon ? text.slice(colon + 1) : text.slice(0, colon);
    }

    function textToCopy(el, event) {
        const raw = el.textContent || "";
        const full = raw.trim();
        if (!full) return "";

        // Shift bypasses the splitting and copies the element as-is.
        if (event.shiftKey) return full;

        const offset = caretOffsetIn(el, event.clientX, event.clientY);
        if (offset === null) return full;

        const segment = segmentAt(raw, offset);
        const refined = splitAtColon(segment.text, offset - segment.start);
        return refined.trim() || full;
    }

    /* ------------------------------------------------------------------ *
     * Click handling
     * ------------------------------------------------------------------ */

    function onDocumentClick(event) {
        if (!state.enabled || !state.enabledGlobally) return;
        if (event.button !== 0) return;
        // Ctrl/Cmd-click stays Spotify's: open the artist / the external credits link.
        if (event.ctrlKey || event.metaKey) return;

        // Deliberately no `event.defaultPrevented` guard. 1.5.x bailed out here, which
        // meant any other capture-phase listener that had already called
        // preventDefault() — including an older copy of this extension still installed
        // alongside — silently disabled copying for whichever names it matched.
        // Copying is safe to do on an already-handled click.

        const root = findCreditsRoot();
        if (!root) return;

        const target = resolveCopyTarget(event, root);
        if (!target) return;

        const text = textToCopy(target, event);
        if (!text) return;

        // Do this before awaiting the clipboard, otherwise the row's own handler
        // navigates away first.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        target.classList.add("ccc-copied");
        setTimeout(() => target.classList.remove("ccc-copied"), COPY_FLASH_MS);

        copyText(text).then(ok => {
            if (!ok) {
                showToast("creditsClickCopy: couldn't write to the clipboard.");
                return;
            }
            debugInfo.lastCopiedText = text;
            debugInfo.lastCopiedAt = new Date().toISOString();
        });
    }

    /* ------------------------------------------------------------------ *
     * DOM watching — marks the open Credits modal (for the copy cursor) and
     * keeps the About-dialog debug block in place.
     * ------------------------------------------------------------------ */

    let markedRoot = null;

    function markCreditsRoot() {
        const root = state.enabled && state.enabledGlobally ? findCreditsRoot() : null;
        if (root === markedRoot) return;

        markedRoot?.removeAttribute?.("data-ccc-credits");
        markedRoot = root;
        markedRoot?.setAttribute?.("data-ccc-credits", debugInfo.creditsVariant);
    }

    const rescan = debounce(() => {
        try {
            markCreditsRoot();
            renderAboutDebugBlock();
        } catch (error) {
            recordError("rescan", error);
        }
    }, RESCAN_DEBOUNCE_MS);

    function installObserver() {
        const observer = new MutationObserver(records => {
            // Ignore the mutations we cause ourselves, or the block would rebuild forever.
            for (const record of records) {
                const target = record.target;
                if (target instanceof Element && target.closest(`#${DEBUG_BLOCK_ID}`)) continue;
                rescan();
                return;
            }
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
        onDestroy(() => {
            observer.disconnect();
            rescan.cancel();
        });
    }

    /* ------------------------------------------------------------------ *
     * Debug block inside the About Spotify dialog
     * ------------------------------------------------------------------ */

    // 1.5.x used "ccc-about-debug" and rewrites that element's innerHTML on a timer.
    // A separate id lets both coexist quietly until the old copy is gone.
    const DEBUG_BLOCK_ID = "ccc-debug-panel";

    function findSpicetifyDetails(root) {
        for (const summary of root.querySelectorAll("summary")) {
            if (/^\s*spicetify\s+v/i.test(summary.textContent || "")) return summary.closest("details");
        }
        return null;
    }

    function findAboutDialog() {
        const aboutLabel = localized(ABOUT_LABEL_KEY);
        const dialogs = Array.from(document.querySelectorAll(DIALOG_SELECTOR));

        for (let i = dialogs.length - 1; i >= 0; i--) {
            const dialog = dialogs[i];
            if (!isVisible(dialog)) continue;
            // Spicetify injects its own version <details> into exactly this dialog,
            // which makes it the most reliable marker available.
            if (findSpicetifyDetails(dialog)) return dialog;
            if (aboutLabel && dialog.getAttribute("aria-label")?.trim() === aboutLabel) return dialog;
        }
        return null;
    }

    function debugRows() {
        return [
            ["Version", CURRENT_VERSION],
            ["Latest version", debugInfo.latestVersion || "(not checked)"],
            ["Enabled (local)", String(state.enabled)],
            ["Enabled (global)", String(state.enabledGlobally)],
            ["Global switch message", debugInfo.globalSwitchMessage || "(none)"],
            ["Popup length (ms)", String(state.popupLengthMs)],
            ["Credits modal open", markedRoot ? "yes" : "no"],
            ["Credits variant", debugInfo.creditsVariant],
            ["Detected via", debugInfo.detectionTier],
            ["Spotify", spotifyVersion() || "(unknown)"],
            ["Spicetify", window.Spicetify?.Config?.version || "(unknown)"],
            ["Last copied", debugInfo.lastCopiedText ? `${debugInfo.lastCopiedText} (${debugInfo.lastCopiedAt})` : "(nothing yet)"],
            ["Clipboard via", debugInfo.clipboardPath],
            ["Loaded at", debugInfo.loadedAt],
            ["Version checked", debugInfo.versionCheckedAt || "(never)"],
            ["Global switch fetched", debugInfo.globalSwitchFetchedAt || "(never)"],
            ["Last error", debugInfo.lastError || "(none)"],
        ];
    }

    const NEWLINE = String.fromCharCode(10);

    const ICON_COPY = '<path d="M10.5 1.5H4A1.5 1.5 0 0 0 2.5 3v8.5H4V3h6.5V1.5Zm2 3H6.5A1.5 1.5 0 0 0 5 6v8a1.5 1.5 0 0 0 1.5 1.5h6A1.5 1.5 0 0 0 14 14V6a1.5 1.5 0 0 0-1.5-1.5Zm0 9.5h-6V6h6v8Z"/>';
    const ICON_RELOAD = '<path d="M8 2.5a5.5 5.5 0 1 0 5.24 3.83l-1.43-.46A4 4 0 1 1 8 4v2.25L11.5 3.5 8 .75V2.5Z"/>';

    function makeButton({ label, icon, title, variant, onClick }) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ccc-btn";
        button.title = title;
        if (variant) button.dataset.variant = variant;
        button.dataset.label = label;

        button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' + icon + '</svg>';

        const text = document.createElement("span");
        text.className = "ccc-btn-label";
        text.textContent = label;
        button.append(text);

        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            Promise.resolve(onClick(button)).catch(error => recordError("debug button", error));
        });

        return button;
    }

    function setBusy(button, label) {
        button.disabled = true;
        button.classList.add("is-busy");
        button.querySelector(".ccc-btn-label").textContent = label;
    }

    /** Confirm an action on the button itself, then put its label back. */
    function flashLabel(button, label, ms = 1400) {
        const target = button.querySelector(".ccc-btn-label");
        target.textContent = label;
        button.classList.add("is-done");
        clearTimeout(button._labelTimer);
        button._labelTimer = setTimeout(() => {
            target.textContent = button.dataset.label;
            button.classList.remove("is-done");
        }, ms);
    }

    function buildDebugBlock() {
        const block = document.createElement("details");
        block.id = DEBUG_BLOCK_ID;
        block.className = "ccc-about-debug";

        const summary = document.createElement("summary");
        summary.textContent = "creditsClickCopy (DEBUG)";
        block.appendChild(summary);

        const body = document.createElement("div");
        body.className = "ccc-body";
        block.appendChild(body);

        const actions = document.createElement("div");
        actions.className = "ccc-actions";
        block.appendChild(actions);

        actions.appendChild(makeButton({
            label: "Copy debug info",
            icon: ICON_COPY,
            title: "Copy every row above as plain text",
            onClick: async button => {
                const ok = await copyText(debugRows().map(([key, value]) => key + ": " + value).join(NEWLINE));
                flashLabel(button, ok ? "Copied" : "Copy failed");
            },
        }));

        actions.appendChild(makeButton({
            label: "Reload extension",
            icon: ICON_RELOAD,
            variant: "accent",
            title: "Fetch the published script again and restart it, the way a Spotify restart would",
            onClick: async button => {
                setBusy(button, "Reloading");
                const how = await reload();
                // A remote reload replaces this whole instance, panel included, so
                // report through Spotify's own notification rather than the button.
                try {
                    window.Spicetify?.showNotification?.(
                        how === "remote" ? "creditsClickCopy reloaded" : "creditsClickCopy restarted (offline)"
                    );
                } catch { /* notification is cosmetic */ }
            },
        }));

        return block;
    }

    function renderAboutDebugBlock() {
        const dialog = findAboutDialog();
        if (!dialog) return;

        // Any panel that is not in the dialog we are rendering into is left over from
        // an earlier instance, and would otherwise show up as a second DEBUG block.
        for (const stray of document.querySelectorAll(`#${DEBUG_BLOCK_ID}`)) {
            if (!dialog.contains(stray)) stray.remove();
        }

        // A block is only ours if it still has the body we built; anything else with
        // this id gets replaced rather than half-updated.
        let block = dialog.querySelector(`#${DEBUG_BLOCK_ID}`);
        if (block && !block.querySelector(".ccc-body")) {
            block.remove();
            block = null;
        }

        if (!block) {
            block = buildDebugBlock();
            const anchor = findSpicetifyDetails(dialog);
            if (anchor) anchor.insertAdjacentElement("afterend", block);
            else (dialog.querySelector("main") || dialog).appendChild(block);
        }

        // Update values in place; rewriting innerHTML here would close the <details>
        // and retrigger the observer on every pass.
        const body = block.querySelector(".ccc-body");
        if (!body) return;

        const rows = debugRows();
        while (body.children.length > rows.length) body.lastElementChild.remove();

        rows.forEach(([key, value], index) => {
            let row = body.children[index];
            if (!row) {
                row = document.createElement("div");
                row.className = "ccc-row";
                row.appendChild(Object.assign(document.createElement("div"), { className: "ccc-key" }));
                row.appendChild(Object.assign(document.createElement("div"), { className: "ccc-value" }));
                body.appendChild(row);
            }
            const keyEl = row.firstElementChild;
            const valueEl = row.lastElementChild;
            if (keyEl.textContent !== `${key}:`) keyEl.textContent = `${key}:`;
            if (valueEl.textContent !== String(value)) valueEl.textContent = String(value);
        });
    }

    /* ------------------------------------------------------------------ *
     * Spotify / remote config helpers
     * ------------------------------------------------------------------ */

    function spotifyVersion() {
        try {
            const fromPlatform = window.Spicetify?.Platform?.version || window.Spicetify?.Platform?.PlatformData?.client_version_triple;
            if (fromPlatform) return String(fromPlatform);
            const match = (navigator.userAgent || "").match(/\bSpotify\/(\d+\.\d+\.\d+(?:\.\d+)*)\b/i);
            return match?.[1] || null;
        } catch {
            return null;
        }
    }

    function clampPopupLength(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return undefined;
        return Math.min(60000, Math.max(500, number));
    }

    async function applyGlobalSwitch() {
        let json;
        try {
            json = await fetchJson(GLOBAL_SWITCH_URL);
        } catch (error) {
            recordError("globalswitch", error);
            return;
        }

        if (!json || typeof json !== "object" || typeof json.enabled_globally !== "boolean") return;

        debugInfo.globalSwitchFetchedAt = new Date().toISOString();
        debugInfo.globalSwitchMessage = typeof json.message === "string" ? json.message : "";

        const popupLength = clampPopupLength(json.popuplenght);
        if (popupLength !== undefined) state.popupLengthMs = popupLength;

        if (json.enabled_globally === false) {
            state.enabledGlobally = false;
            markCreditsRoot();
            showToast(`creditsClickCopy: Extension disabled globally, reason: ${debugInfo.globalSwitchMessage}`);
        }
    }

    async function checkVersion() {
        let json;
        try {
            json = await fetchJson(VERSION_URL);
        } catch (error) {
            recordError("version check", error);
            return;
        }

        if (!json?.version) return;
        debugInfo.versionCheckedAt = new Date().toISOString();
        debugInfo.latestVersion = String(json.version);

        if (debugInfo.latestVersion !== CURRENT_VERSION) {
            showToast(`creditsClickCopy: Update available. Current: v${CURRENT_VERSION} · Latest: v${debugInfo.latestVersion}`);
        }
    }

    /* ------------------------------------------------------------------ *
     * Profile menu toggle
     * ------------------------------------------------------------------ */

    function setEnabled(next) {
        state.enabled = next;
        setStoredEnabled(next);
        markCreditsRoot();
    }

    /**
     * Spicetify.Menu.Item builds a React element in its constructor, so it can exist
     * while Spicetify.React does not — right after a reload it throws
     * "Cannot read properties of undefined (reading 'jsx')". Wait for React too, and
     * retry on failure instead of taking the rest of the extension down with it.
     */
    function menuApiReady() {
        const spicetify = window.Spicetify;
        return Boolean(spicetify?.Menu?.Item && spicetify?.React && spicetify?.ReactDOM && spicetify?.Platform);
    }

    /**
     * Tracked outside install() so a teardown that never ran (a crash mid-restart, an
     * older copy of this file) still cannot leave a second entry in the profile menu.
     */
    let activeMenuItem = null;

    function installMenuToggle() {
        let menuItem = null;
        let cancelled = false;
        let retryTimer = 0;
        let attemptsLeft = 100;

        const attempt = () => {
            if (cancelled) return;

            const retry = () => {
                if (attemptsLeft-- <= 0) {
                    recordError("menu toggle", new Error("Spicetify.Menu never became usable"));
                    return;
                }
                retryTimer = setTimeout(attempt, 300);
            };

            if (!menuApiReady()) return retry();

            try {
                try { activeMenuItem?.deregister?.(); } catch { /* already gone */ }
                activeMenuItem = null;

                menuItem = new window.Spicetify.Menu.Item("creditsClickCopy", state.enabled, self => {
                    const next = !self.isEnabled;
                    self.setState(next);
                    setEnabled(next);
                    try {
                        window.Spicetify?.showNotification?.(`creditsClickCopy ${next ? "enabled" : "disabled"}`);
                    } catch { /* notification is cosmetic */ }
                });
                menuItem.register();
                activeMenuItem = menuItem;
            } catch {
                menuItem = null;
                retry();
            }
        };

        attempt();
        onDestroy(() => {
            cancelled = true;
            clearTimeout(retryTimer);
            try { menuItem?.deregister?.(); } catch { /* ignore */ }
            if (activeMenuItem === menuItem) activeMenuItem = null;
        });
    }

    /* ------------------------------------------------------------------ *
     * Bootstrap
     * ------------------------------------------------------------------ */

    function install() {
        // install() and destroy() have to stay symmetric: every restart re-registers
        // the full teardown list, and a second install can never stack on a live one.
        if (state.installed) return;

        if (!document.body) {
            const retry = setTimeout(install, 100);
            onDestroy(() => clearTimeout(retry));
            return;
        }

        cleanUpLegacyStorage();
        state.enabled = getStoredEnabled();

        onDestroy(() => {
            clearTimeout(toastTimer);
            toastEl?.remove();
            toastEl = null;
        });
        onDestroy(() => {
            for (const panel of document.querySelectorAll(`#${DEBUG_BLOCK_ID}`)) panel.remove();
        });

        installStyles();
        installObserver();

        document.addEventListener("click", onDocumentClick, true);
        onDestroy(() => document.removeEventListener("click", onDocumentClick, true));

        // Click-to-copy is live from here on; the menu entry is a nice-to-have that
        // must never be able to take the rest of the extension down.
        try {
            installMenuToggle();
        } catch (error) {
            recordError("menu toggle", error);
        }

        state.installed = true;
        rescan();

        // Network work never blocks click-to-copy; the kill switch applies as soon
        // as it lands.
        applyGlobalSwitch().then(() => state.enabledGlobally && checkVersion());

        log(`v${CURRENT_VERSION} ready (Spotify ${spotifyVersion() || "?"}).`);
    }

    /** Restart this copy without the network: same effect, minus a fresh download. */
    function restartInPlace() {
        destroy();
        state.enabledGlobally = true;
        state.popupLengthMs = DEFAULT_POPUP_LENGTH_MS;
        debugInfo.loadedAt = new Date().toISOString();
        debugInfo.lastError = null;
        window.creditsClickCopy = api;
        install();
    }

    /**
     * Re-runs the extension the way a Spotify restart would: fetch the published
     * script again and evaluate it, so a newly released version is picked up without
     * restarting the client. The freshly evaluated copy tears this one down itself.
     */
    async function reload() {
        let code = null;
        for (const url of SOURCE_URLS) {
            try {
                code = await fetchText(url);
                break;
            } catch (error) {
                recordError("reload", error);
            }
        }

        if (code === null) {
            restartInPlace();
            return "local";
        }

        // Stand this copy down before handing over. A release older than the public
        // API cannot tear us down itself, and evaluating it on top of a live instance
        // is exactly how you end up with two of everything.
        destroy();

        const script = document.createElement("script");
        script.textContent = `${code}${NEWLINE}//# sourceURL=creditsClickCopy.js`;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        return "remote";
    }

    function destroy() {
        while (disposers.length) {
            try { disposers.pop()(); } catch { /* keep tearing down */ }
        }
        markedRoot?.removeAttribute?.("data-ccc-credits");
        markedRoot = null;
        state.installed = false;
        if (window.creditsClickCopy === api) delete window.creditsClickCopy;
    }

    /* ------------------------------------------------------------------ *
     * Public API — also what `ccc` talks to.
     * ------------------------------------------------------------------ */

    const api = {
        version: CURRENT_VERSION,
        get enabled() { return state.enabled; },
        get installed() { return state.installed; },
        enable: () => setEnabled(true),
        disable: () => setEnabled(false),
        toggle: () => setEnabled(!state.enabled),
        destroy,
        reload,
        debug: () => ({ version: CURRENT_VERSION, ...debugInfo, ...state }),
        findCreditsRoot,
        showToast,
    };

    window.creditsClickCopy = api;
    install();
})();
