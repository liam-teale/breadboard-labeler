# Breadboard labeler

Click-and-type labels burned into photos. Built for "many photos a week, each
label in a different spot, same style every time".

A label has three parts: the text, a small hollow square on the part it refers to, and a
straight line joining them.

## Run it

1. Double-click `label.bat`. A file picker opens: Ctrl-click or Shift-click the photos you want.
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

## Keys

| Key | Does |
| --- | --- |
| Enter | place the label you are typing |
| Esc | cancel the label you are typing, or clear the selection |
| S | save and go to next photo |
| N / P (or arrow keys) | next / previous photo without saving |
| O | open more photos into the queue |
| Z | undo the last label |
| Delete | delete the selected label |
| + / - | bigger / smaller text (remembered for next week) |
| [ / ] | smaller / bigger square |
| C | cycle preset colours: yellow, white, black, red, cyan, green |
| K | pick any colour from a colour dialog |
| Q | quit (warns once if you have unsaved labels) |

**Colours and square size:** with a label selected (click its text), C, K, [ and ] change that one
label. With nothing selected, they set the defaults for every new label from then on, and those
defaults are remembered between runs. The outline colour is picked automatically: black under light
colours, white under dark ones.

Clicking somewhere new while still typing a label places that label and starts the next one, so
you can chain click, type, click, type without pressing Enter.

## What it writes

- `photo_labeled.jpg` (or `.png`) next to each original. Originals are never touched.
- `.labeler/photo.json` in the same folder: the labels, positions, colours and square sizes. Reopening a photo
  reloads them so you can move one, fix a typo, and press S again.
- `~/.breadboard_labeler.json`: your text size and colour, so they stick between runs.

Files already ending in `_labeled` are skipped, so you can rerun on the same folder safely.

## Details

- Text height defaults to 3% of the image width, so labels look the same size on a 12 MP phone
  photo and a 1200 px screenshot.
- Phone photos with EXIF rotation are shown and saved upright at full resolution.
- Needs Python 3 with Pillow: `pip install pillow`. tkinter ships with Python on Windows.
- Flags: `--size 4` (text %), `--colour "#FFFFFF"`, `--suffix _annotated`, `--start 5`.
- `python test_drive.py` runs the self-test (off-screen window, simulated clicks and keys).
