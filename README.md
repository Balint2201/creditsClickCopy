# Credits Click Copy

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

## Downsides / caveats
- The click-to-copy handler is always active (global). If Spotify changes class names/markup, it may stop working.
- If Spotify ever uses `*credit*` class names in other UI areas, this may also intercept those clicks.
- While enabled, the extension captures the click (to prevent navigation/selection) when it decides a click is a copy-target.

## \*\*Made for Spicy Lyrics TTML Makers\*\*
