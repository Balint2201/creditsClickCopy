# creditsClickCopy

A small Spicetify extension that lets you copy Credits names with a single click.

## Features
- Click any artist / writer / producer name
- Instantly copies to clipboard
- No text selection needed
- Works around Spotify selection restrictions

## Usage
Open a track → View Credits → click a name to copy it.

## Toggle (disable/enable)
You can disable the extension without uninstalling it:

- Profile menu → Credits Click Copy (checkmark toggle)

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
