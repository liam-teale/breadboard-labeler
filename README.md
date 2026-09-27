# Breadboard labeler

Click-and-type labels burned into photos. Built for "many photos a week, each
label in a different spot, same style every time".

**https://liam-teale.github.io/breadboard-labeler/**

A label has three parts: the text on a solid coloured box, a solid square on the
part it refers to, and a straight line joining them.

Runs entirely in the browser. Photos never leave your device and are never modified:
every save is a new download. Works on phones and tablets, and can be installed as an
app (Chrome: menu, "Install app"; iPhone: Share, "Add to Home Screen"). Once installed
it works offline.

## How to use it

1. **Open photos** to pick individual photos, or **Open folder** to take every photo in a
   folder. Dropping files on the page works too. JPG, PNG, WebP and iPhone HEIC all open.
2. **Click the part.** The square lands there and a text box opens beside it. Type, Enter.
   Or **drag** from the part to where the text should go.
3. **Drag the text** or **the square** to move them. **Click a label** to select it,
   **double-click** to edit its text.
4. **Save** writes `name_labeled.jpg` and moves to the next photo. **Save all** does every
   labelled photo. The **as JPG / as PNG** dropdown picks the output format for every save,
   whatever the input was.

**Where saves go.** In Chrome and Edge, photos opened with **Open folder** are saved straight
into that folder, next to the originals, after a one-time "save changes" prompt from the browser.
Photos opened individually, or on other browsers, are downloaded instead. The **into folder / to
Downloads** dropdown lets you force downloads. Nothing is ever overwritten: a second save of the
same photo becomes `name_labeled_2.jpg`.

**Picking up where you left off.** In Chrome and Edge the app remembers which photos and folders
were open. After a reload, or if Chrome discards the tab to save memory, it reopens them at the
same photo, asking once for permission if the browser needs it.

Labels are remembered per photo in your browser, so reopening the same photo later
restores them. Undo, redo, text size, square size and colour are all in the toolbar.

## Keys

| Key | Does |
| --- | --- |
| Enter | place the label you are typing |
| Esc | cancel the label you are typing, or clear the selection |
| S | save and go to next photo |
| N / P (or arrow keys) | next / previous photo |
| O / F | open more photos / a whole folder |
| Z / Y | undo / redo |
| Delete | delete the selected label |
| + / - | bigger / smaller text |
| [ / ] | smaller / bigger square |
| C | cycle preset colours: yellow, orange, blue, pink, green, brown, red, white, light grey, black, then your own |
| K | pick any colour |
| + (toolbar) | save the current colour as a preset; right-click a custom preset to remove it |
| Shift-click | text-only label, no square (the "Text only" button does the same on touch screens) |
| ? | show this list in the app |

**Colours and square size:** with a label selected (click its text), C, K, [ and ] change that one
label. While you are typing a new label, colour changes apply to that label immediately. With
nothing selected, they set the defaults for every new label from then on, and those defaults are
remembered, as are your custom presets. The text colour is picked automatically: black on light colours, white
on dark ones.

Clicking somewhere new while still typing a label places that label and starts the next one, so
you can chain click, type, click, type without pressing Enter.

## Details

- Text height defaults to 3% of the image width, so labels look the same size on a 12 MP phone
  photo and a 1200 px screenshot. Output is full resolution.
- Photos with EXIF rotation are shown and saved upright.
- Only the current photo and its two neighbours are kept decoded in memory, so opening a whole
  folder of 12 MP photos is fine. Nothing runs while you are not interacting.
- HEIC files are decoded in the browser with [heic-to](https://github.com/hoppergee/heic-to)
  (libheif 1.22, including the 10-bit HDR files newer iPhones shoot), downloaded the first time one
  is opened (about 3 MB) and cached for offline use after that.
- Files whose names end in `_labeled`, `_labeled_2`, ... are treated as earlier outputs and skipped.

## Browser support

Chrome and Edge get everything. Safari and Firefox lack the File System Access API, so there the
Open buttons use the ordinary file picker, saves are downloads, and sessions are not remembered.

## Development

Plain HTML, CSS and JavaScript in `docs/`, served by GitHub Pages from `main`. No build step.
`web-test/harness.html` is the self-test: serve the repo root (`python -m http.server`) and open
it in a browser, or drive it headless. An earlier Python desktop version lives in the git history
before the "Retire the desktop version" commit.
