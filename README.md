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
   **Maths:** put TeX between dollar signs, `10 k$\Omega$` or `$V_{out}$`, and it is typeset with
   MathJax; the text around it stays as it is. The first such label downloads MathJax (about 2 MB,
   kept for offline use after that). Until it has rendered, the label shows the raw TeX.
   **Pins:** the panel on the right is the Analog Discovery 2 / 3 connector in its wire colours.
   Click a pin, then click its wire on the photo (or drag from the wire to where the text should go):
   the label is placed at once with the pin's name and the wire's colour, white stripe included.
   Each pin can be on a photo once: while it is there, it is greyed out in the panel (the four
   grounds count separately). Delete the label and the pin comes back. The **Pins** button hides
   and shows the panel; it is shown again on every load.
   The **↺ / ↻** buttons (or R / Shift-R) **rotate the photo** in 90° steps. Labels turn with it and stay
   on their parts; the saved copy comes out rotated. Undo turns it back.
4. **Save** writes `name_labeled.jpg` and moves to the next photo. **Save all** does every
   labelled photo. The **as JPG / as PNG** dropdown picks the output format for every save,
   whatever the input was.
5. **Done** (or D) when you are finished with a breadboard: the photo comes off the list and is not
   reopened next time. If it has labels you have not saved yet, you are asked whether to save first.
   Its labels are still remembered, so opening the same photo again later brings them back.

**Where saves go.** In Chrome and Edge, photos opened with **Open folder** are saved straight
into that folder, next to the originals, after a one-time "save changes" prompt from the browser.
Photos opened individually, or on other browsers, are downloaded instead. The **into folder / to
Downloads** dropdown lets you force downloads. Nothing is ever overwritten: a second save of the
same photo becomes `name_labeled_2.jpg`.

**Picking up where you left off.** When you open photos, the app keeps a private copy of each
original inside the browser's storage. After a reload, or if the browser discards the tab to save
memory, it reopens the same photos at the same place with no prompt. Copies are discarded after two
weeks. On Chrome and Edge the folder link is remembered too, so saving into the folder keeps working
after a restore (the browser may ask once before the first save).

Labels are remembered per photo in your browser, so reopening the same photo later
restores them. Undo, redo, text size, square size and colour are all in the toolbar.

## Keys

| Key | Does |
| --- | --- |
| Enter | place the label you are typing |
| Esc | cancel the label you are typing, or clear the selection |
| S | save and go to next photo |
| D | done with this photo: take it off the list (asks first if it has unsaved labels) |
| N / P (or arrow keys) | next / previous photo |
| O / F | open more photos / a whole folder |
| Z / Y | undo / redo |
| Delete | delete the selected label |
| + / - | bigger / smaller text |
| [ / ] | smaller / bigger square |
| C | cycle preset colours: yellow, orange, blue, pink, green, brown, red, white, light grey, black, then your own |
| K | pick any colour |
| #RRGGBB box | type a colour as hex (next to the colour picker); + then saves it as a preset |
| + (toolbar) | save the current colour as a preset; right-click a custom preset to remove it |
| Shift-click | text-only label, no square (the "Text only" button does the same on touch screens) |
| R / Shift-R | rotate the photo right / left by 90° (labels turn with it) |
| Pins | show / hide the AD2 / AD3 pinout panel; Esc cancels a pin you have picked |
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
- Photos with EXIF rotation are shown and saved upright. A rotation you apply on top is remembered
  per photo (with its labels) and applied when drawing, so it costs no extra memory.
- Only the current photo and its two neighbours are kept decoded in memory, so opening a whole
  folder of 12 MP photos is fine. Nothing runs while you are not interacting.
- HEIC files are decoded in the browser with [heic-to](https://github.com/hoppergee/heic-to)
  (libheif 1.22, including the 10-bit HDR files newer iPhones shoot), downloaded the first time one
  is opened (about 3 MB) and cached for offline use after that.
- Files whose names end in `_labeled`, `_labeled_2`, ... are treated as earlier outputs and skipped.
- The pinout (`docs/pinouts.js`) follows Digilent's Analog Discovery pin-out sheet: top row
  1+ 2+ GND V+ W1 GND T1 DIO 0-7, bottom row 1- 2- GND V- W2 GND T2 DIO 8-15, with the bottom-row
  wires white-striped. The AD2 and AD3 use the same header and the same flywire harness.
- Maths is typeset by [MathJax](https://www.mathjax.org/) 3 (TeX to SVG), loaded from jsdelivr the
  first time a label contains `$...$` and cached by the service worker like the HEIC decoder. Each
  expression is rendered once to an SVG image and drawn into the label at the text's x-height.

## Browser support

Chrome and Edge get everything. Safari and Firefox lack the File System Access API, so there the
Open buttons use the ordinary file picker and saves are downloads. Session memory works wherever
the browser's private file storage does (current Firefox and Chrome-based browsers).

## Development

Plain HTML, CSS and JavaScript in `docs/`, served by GitHub Pages from `main`. No build step.
`web-test/harness.html` is the self-test: serve the repo root (`python -m http.server`) and open
it in a browser, or drive it headless. An earlier Python desktop version lives in the git history
before the "Retire the desktop version" commit.
