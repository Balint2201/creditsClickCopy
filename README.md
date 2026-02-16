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

## Downsides / caveats
- The extension is scoped to Spotify's Credits modal. If Spotify changes the Credits modal class names/markup, it may stop working.
- While enabled, the extension captures the click (to prevent navigation/selection) when it decides a click is a copy-target.
- The extension will forcefully disable the new Credits styling introduced in Spotify 1.2.83, to reanable it navigat to the Experimental Features and turn on TrackCreditsModalV2.

## \*\*Made for Spicy Lyrics TTML Makers\*\*
