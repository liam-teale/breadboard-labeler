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
4. **Save** downloads `name_labeled.jpg` and moves to the next photo. **Save all** downloads
   every labelled photo. The **as JPG / as PNG** dropdown picks the output format for every
   save, whatever the input was.

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
| C | cycle preset colours: yellow, white, black, red, cyan, green |
| K | pick any colour |
| Shift-click | text-only label, no square (the "Text only" button does the same on touch screens) |
| ? | show this list in the app |

**Colours and square size:** with a label selected (click its text), C, K, [ and ] change that one
label. With nothing selected, they set the defaults for every new label from then on, and those
defaults are remembered. The text colour is picked automatically: black on light colours, white
on dark ones.

Clicking somewhere new while still typing a label places that label and starts the next one, so
you can chain click, type, click, type without pressing Enter.

## Details

- Text height defaults to 3% of the image width, so labels look the same size on a 12 MP phone
  photo and a 1200 px screenshot. Output is full resolution.
- Photos with EXIF rotation are shown and saved upright.
- HEIC files are decoded in the browser with [heic-to](https://github.com/hoppergee/heic-to)
  (libheif 1.22, including the 10-bit HDR files newer iPhones shoot), downloaded the first time one
  is opened (about 3 MB) and cached for offline use after that.
- Files whose names end in `_labeled`, `_labeled_2`, ... are treated as earlier outputs and skipped.

## Development

Plain HTML, CSS and JavaScript in `docs/`, served by GitHub Pages from `main`. No build step.
`web-test/harness.html` is the self-test: serve the repo root (`python -m http.server 8765`) and open
it in a browser, or drive it headless. `web-test/sw-check.mjs` proves the offline story: run it with
`online` while the server is up, stop the server, then run it with `offline` (it blocks the CDN too). An earlier Python desktop version lives in the git history
before the "Retire the desktop version" commit.
