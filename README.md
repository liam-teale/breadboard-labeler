# Breadboard labeler

Click-and-type labels burned into photos. Built for "many photos a week, each
label in a different spot, same style every time".

A label has three parts: the text on a solid coloured box, a solid square on the
part it refers to, and a straight line joining them.

## Web app (share this one)

**https://liam-teale.github.io/breadboard-labeler/**

Runs entirely in the browser. Photos never leave your device. Works on phones and tablets,
and can be installed as an app (Chrome: menu, "Install app"; iPhone: Share, "Add to Home Screen").

1. **Open photos** to pick individual photos, or **Open folder** to take every photo in a folder
   (or drop files on the page).
2. **Tap the part.** The square lands there and a text box opens beside it. Type, Enter.
   Or **drag** from the part to where the text should go.
3. **Drag the text** or **the square** to move them. **Tap a label** to select it, **double-tap** to edit.
4. **Save** downloads a new `name_labeled.jpg` and moves to the next photo. **Save all** downloads every labelled photo.

Your original photos are never modified. Every save is a new download.

Undo/redo, text size, square size and colour are toolbar buttons. Press `?` for the key list
(same keys as the desktop version below). Labels are remembered per photo in your browser, so
reopening the same photo later restores them.

The web app lives in `docs/` and is plain HTML, CSS and JavaScript with no build step.
`web-test/harness.html` is its self-test; open it in a browser or run it headless.

## Desktop version (Python)

1. Double-click `label.bat`. A file picker opens: Ctrl-click or Shift-click the photos you want.
   Press Cancel there to get a folder picker instead. Inside the app, **O** opens more photos and **F** a folder.
2. For each photo:
   - **Click the part.** The square lands there and a text box opens beside it. Type, **Enter**.
   - **Or drag:** press on the part, drag to where the text should sit, release, type, **Enter**.
   - **Drag the text** to move it. The square stays on the part. **Drag the square** to move that.
   - **Shift-click** for a text-only label with no square or line.
   - **Double-click a label** to change its text.
   - **S** saves `name_labeled.jpg` next to the original and opens the next photo.
3. After the last photo it closes itself.

Other ways to start it: drop photos (or a folder) onto `label.bat`, or from a terminal
`python label_images.py a.jpg b.jpg` or `python label_images.py "C:\path\to\folder"`.

Needs Python 3 with Pillow: `pip install pillow`. tkinter ships with Python on Windows.
`python test_drive.py` runs the self-test (off-screen window, simulated clicks and keys).

## Keys (both versions)

| Key | Does |
| --- | --- |
| Enter | place the label you are typing |
| Esc | cancel the label you are typing, or clear the selection |
| S | save and go to next photo |
| N / P (or arrow keys) | next / previous photo without saving |
| O / F | open more photos / a whole folder into the queue |
| Z / Y | undo / redo |
| Delete | delete the selected label |
| + / - | bigger / smaller text (remembered for next week) |
| [ / ] | smaller / bigger square |
| C | cycle preset colours: yellow, white, black, red, cyan, green |
| K | pick any colour from a colour dialog |
| Q | quit the desktop version (warns once if you have unsaved labels) |

**Colours and square size:** with a label selected (click its text), C, K, [ and ] change that one
label. With nothing selected, they set the defaults for every new label from then on, and those
defaults are remembered between runs. The text colour is picked automatically: black on light
colours, white on dark ones.

Clicking somewhere new while still typing a label places that label and starts the next one, so
you can chain click, type, click, type without pressing Enter.

## What the desktop version writes

- `photo_labeled.jpg` (or `.png`) next to each original. Originals are never touched, and no file is ever
  overwritten: saving the same photo again writes `photo_labeled_2.jpg`, then `_3`, and so on.
- `.labeler/photo.json` in the same folder: the labels, positions, colours and square sizes.
  Reopening a photo reloads them so you can move one, fix a typo, and press S again.
- `~/.breadboard_labeler.json`: your text size, square size and colour, so they stick between runs.

Earlier outputs (`_labeled`, `_labeled_2`, ...) are skipped when opening, so you can rerun on the same folder safely.

## Details

- Text height defaults to 3% of the image width, so labels look the same size on a 12 MP phone
  photo and a 1200 px screenshot.
- Phone photos with EXIF rotation are shown and saved upright at full resolution.
- Flags for the desktop version: `--size 4` (text %), `--colour "#FFFFFF"`, `--suffix _annotated`, `--start 5`.
