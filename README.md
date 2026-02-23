# creditsClickCopy

A small Spicetify extension that lets you copy Credits names with a single click.

## Client-side features
- Click-to-copy inside the Credits modal (artist / writer / producer names)
	- Only triggers for left-clicks on credit name elements inside the currently open Credits modal
	- Prevents default click behavior to avoid navigation/selection issues
- Clipboard support
	- Uses `navigator.clipboard.writeText()` when available
	- Falls back to a hidden textarea + `document.execCommand("copy")` if needed
- Lightweight UI feedback
	- Shows a copy cursor on eligible names
	- Briefly flashes the clicked element (opacity change)
	- Can show in-app toast notifications (update available / warnings / global switch + reason)
- Enable/disable toggle (client-side state)
	- Adds a Profile menu toggle: "creditsClickCopy"
	- Persists enabled state via Spicetify LocalStorage (with `localStorage` fallback)
- Compatibility handling for Spotify Credits modal
	- Can attempt to disable the Spotify Remote Config experiment: "Enables the new TrackCreditsModal implementation" (Spotify versions `>= 1.2.83`)
	- May trigger a one-time reload after changing that override
	- If the experiment can’t be overridden effectively, shows a warning toast
- Debug info injection (local)
	- Adds a collapsible "creditsClickCopy (DEBUG)" block in the About Spotify dialog showing local status (version, toggle state, last checks, etc.)

## Client-side network calls
The extension may fetch two small JSON files from GitHub (no user data is uploaded):
- `version.json` (to notify if an update is available)
- `globalswitch.json` (optional global kill-switch + toast duration)

## Usage
Open a track → View Credits → click a name to copy it.

## Toggle (disable/enable)
You can disable the extension without uninstalling it:

- Profile menu → creditsClickCopy (checkmark toggle)

The state is saved and will persist across restarts.

When disabled locally, the extension also attempts to re-enable Spotify's experiment:

- "Enables the new TrackCreditsModal implementation"

## TrackCreditsModal experiment handling
To keep the Credits click-to-copy working, the extension attempts to override (set to `false`) the experiment:

- "Enables the new TrackCreditsModal implementation"

Note: This experiment override is only attempted on Spotify app versions `>= 1.2.83`. On `1.2.82` and below, the extension will not attempt to disable the experiment and will not show the related warning toast.

If it cannot be overridden and the value isn't effectively `false`, the extension shows a warning toast that it may not work.

## Downsides / caveats
- The extension is scoped to Spotify's Credits modal. If Spotify changes the Credits modal class names/markup, it may stop working.
- While enabled, the extension captures the click (to prevent navigation/selection) when it decides a click is a copy-target.
- The extension may trigger a one-time reload when toggling the TrackCreditsModal experiment override.

## \*\*Made for Spicy Lyrics TTML Makers\*\*
