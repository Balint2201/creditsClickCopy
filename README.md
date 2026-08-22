# creditsClickCopy

A small Spicetify extension that lets you copy Credits names with a single click.

Open a track → **View credits** → click a name. It is on your clipboard.

## Works on every current Credits modal

Spotify ships three different Credits modal implementations and decides server-side
which one you get, so two people on the same Spotify build can see different markup:

| Variant | Enabled by | What it looks like |
| --- | --- | --- |
| `classic` | neither flag | `main-trackCreditsModal-*`, names grouped under a role heading |
| `listRows` | `enableTrackCreditsModalV2` | hashed class names, one row per person, roles as a subtitle |
| `modalV2` | `enableGroupedCredits` | `main-trackCreditsModalV2-*`, rows grouped by role group |

(The two flag names are the wrong way round in Spotify's own bundle —
`enableGroupedCredits` is what selects the V2 container, and it outranks the
other flag. Detection is done on markup, never on the flags.)

All three are supported directly, verified against Spotify 1.2.92. The extension
no longer overrides Spotify's experiments to force the old modal back, it never
touches remote config at all, and it never reloads the client behind your back.

The two newer variants put each row's click handler on an invisible overlay that
covers the whole row, so a click never reaches the name element. Names are found
by hit-testing the point you clicked, so the actual text under the cursor is what
gets copied.

Two other things that broke older versions and are fixed here: Spotify's modals
are native `<dialog>` elements with no `role="dialog"` attribute, and 1.5.x
skipped any click whose default had already been prevented by another
capture-phase listener — including an older copy of itself.

## Clicking

Only the **track title** and the **credited names** are copy targets. Role labels
("Written by", "Composer • Lyricist"), section headings ("Credits", "Additional
credits", role group titles) and the sources row are left alone, in all three
variants.

| Action | Result |
| --- | --- |
| Click a name or the track title | copies it |
| Click one name in a list of several | copies just that one, not the whole line |
| **Shift**+click | copies the whole element, no splitting |
| **Ctrl**/**Cmd**+click | leaves the click to Spotify (opens the artist / the credits link) |
| Click a label, heading or button | never intercepted — Spotify keeps its own behaviour |

Copy targets show a copy cursor and flash when copied; everything else keeps the
normal cursor, so you can see what is clickable before you click.

## Toggle

Profile menu → **creditsClickCopy** (checkmark). The state is saved and survives
restarts. While disabled the extension keeps no click listener active.

## Console API

The extension registers `window.creditsClickCopy`:

```js
creditsClickCopy.version          // "2.0.0"
creditsClickCopy.enabled          // current toggle state
creditsClickCopy.enable()         // / .disable() / .toggle()
creditsClickCopy.debug()          // everything the DEBUG panel shows, incl. the
                                  // detected variant and which clipboard path worked
creditsClickCopy.findCreditsRoot()// the detected modal element, or null
creditsClickCopy.reload()         // re-fetch and restart, as if Spotify had restarted
creditsClickCopy.destroy()        // full teardown
```

There is also a collapsible **creditsClickCopy (DEBUG)** block in the About
Spotify dialog with the same information and two buttons:

- **Copy debug info** — puts every row on the clipboard as plain text
- **Reload extension** — fetches the published script again and restarts it, so a
  new release takes effect without restarting Spotify. With no network it
  restarts the running copy in place instead.

## Network calls

Two small JSON files are fetched from GitHub on start. Nothing is uploaded.

- `version.json` — notifies you when a newer version exists
- `globalswitch.json` — a remote kill switch (`enabled_globally`, `message`,
  `popuplenght`) for the case where a Spotify update breaks the extension

Click-to-copy is installed immediately and does not wait for either request; the
kill switch applies as soon as its response lands.

## Installing

Via Spicetify Marketplace, or manually:

```sh
ccc install                                        # copies the loader into Spicetify's Extensions dir
spicetify config extensions creditsClickCopy-load.js
spicetify apply
```

`creditsClickCopy-load.js` is only a loader: it fetches `creditsClickCopy.js`
from GitHub (with a jsDelivr fallback) at startup, so fixes arrive without
reinstalling.

## `ccc` — live injection while you work

Spotify is Chromium underneath. Start it with a debug port and the extension can
be evaluated straight into the running UI — no `spicetify apply`, no restart.

```sh
npm link          # once, to put `ccc` on your PATH
                  # or run ./ccc (macOS/Linux) / ccc.cmd (Windows) from the repo

ccc launch --restart   # restarts Spotify with --remote-debugging-port=9222
ccc inject             # evaluate your local creditsClickCopy.js in the live client
ccc watch              # ...and re-evaluate it on every save
```

| Command | |
| --- | --- |
| `ccc inject` | inject `creditsClickCopy.js` (`--file <path>`, `--remote` to inject the loader instead) |
| `ccc watch` | inject, then re-inject on every save |
| `ccc uninject` | tear the running instance down |
| `ccc reload` | reload the Spotify UI (`--hard` bypasses the cache) |
| `ccc eval "<js>"` | evaluate an expression in the client |
| `ccc logs` | stream the client's console (`--filter <text>`) |
| `ccc status` | targets, Spicetify version, extension state, detected modal variant |
| `ccc launch` | start Spotify with the debug port (`--restart` replaces a running one) |
| `ccc install` | copy the loader into Spicetify's Extensions directory |

`--port` and `--host` override the devtools endpoint (default `127.0.0.1:9222`),
`--target <id>` picks a specific renderer instead of auto-detecting the one that
has Spicetify loaded.

`ccc reload` reloads only the web view, which Spotify does not always survive — if
the window comes back blank, use `ccc launch --restart` instead.

Requires Node 22+ (for the built-in WebSocket). There are no dependencies.

Injection re-evaluates the whole file, which is safe: the script destroys any
previous instance of itself before installing listeners.

## Caveats

- Spotify can change the Credits markup at any time. `ccc status` reports which
  variant was detected and how, which is the first thing to check if copying
  stops working. Detection falls back through four signals, the last two of which
  (the `song-credits` help link, then the dialog label) survive a UI rewrite.
- `Spicetify.Locale` is missing in some Spicetify builds, so label-based detection
  falls back to a fixed word list. The help-link signal covers the rest.
- While enabled, a click that resolves to a credit name is consumed, so it does
  not also navigate. Ctrl/Cmd+click if you want to navigate.
- `version.json` and `globalswitch.json` are fetched from fixed URLs that
  installed copies already point at, so their paths and key names cannot change.

## \*\*Made for Spicy Lyrics TTML Makers\*\*
