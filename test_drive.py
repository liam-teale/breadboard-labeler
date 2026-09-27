"""Drive label_images.py with synthetic events and check the results.

Run:  python test_drive.py
Opens the window off-screen, fakes clicks/typing, saves outputs and preview
renders under a temp folder, and prints PASS/FAIL per check."""
import json
import shutil
import sys
import tempfile
import tkinter as tk
from pathlib import Path
from types import SimpleNamespace

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw  # noqa: E402

import label_images as li  # noqa: E402

TMP = Path(tempfile.gettempdir()) / "breadboard-labeler-test"
TMP.mkdir(exist_ok=True)
WORK = TMP / "photos"
SHOTS = TMP / "shots"
li.CONFIG_PATH = TMP / "test_config.json"   # never touch the real config


def make_board(path: Path, size, exif_rotate=False):
    """Synthetic breadboard-ish photo: white body, hole grid, red/blue rails, a few parts."""
    w, h = size
    img = Image.new("RGB", (w, h), (215, 210, 200))
    d = ImageDraw.Draw(img)
    d.rectangle([w * 0.05, h * 0.15, w * 0.95, h * 0.85], fill=(245, 243, 238))
    step = w / 60
    for gx in range(6, 55):
        for gy in range(12, 46):
            if gy in (27, 28):
                continue
            x, y = w * 0.05 + gx * step, h * 0.15 + gy * step
            d.rectangle([x, y, x + step * 0.4, y + step * 0.4], fill=(60, 60, 60))
    d.line([w * 0.06, h * 0.18, w * 0.94, h * 0.18], fill=(200, 30, 30), width=int(step / 3))
    d.line([w * 0.06, h * 0.22, w * 0.94, h * 0.22], fill=(30, 60, 200), width=int(step / 3))
    d.rectangle([w * 0.30, h * 0.45, w * 0.42, h * 0.48], fill=(200, 170, 110))
    for i, c in enumerate([(160, 60, 40), (40, 40, 40), (200, 100, 20)]):
        d.rectangle([w * (0.32 + i * 0.03), h * 0.45, w * (0.33 + i * 0.03), h * 0.48], fill=c)
    d.ellipse([w * 0.60, h * 0.40, w * 0.64, h * 0.47], fill=(220, 40, 40))
    d.rectangle([w * 0.45, h * 0.55, w * 0.58, h * 0.66], fill=(30, 30, 30))
    d.line([w * 0.20, h * 0.18, w * 0.20, h * 0.40], fill=(220, 40, 40), width=int(step / 2))
    d.line([w * 0.70, h * 0.22, w * 0.70, h * 0.60], fill=(40, 40, 220), width=int(step / 2))
    d.line([w * 0.25, h * 0.70, w * 0.55, h * 0.70], fill=(40, 180, 40), width=int(step / 2))
    if exif_rotate:
        rotated = img.rotate(90, expand=True)
        exif = Image.Exif()
        exif[0x0112] = 6
        rotated.save(path, quality=92, exif=exif)
    else:
        img.save(path, quality=92) if path.suffix == ".jpg" else img.save(path)


def setup():
    shutil.rmtree(WORK, ignore_errors=True)
    shutil.rmtree(SHOTS, ignore_errors=True)
    WORK.mkdir(parents=True)
    SHOTS.mkdir(parents=True)
    if li.CONFIG_PATH.exists():
        li.CONFIG_PATH.unlink()
    make_board(WORK / "IMG_0001.jpg", (4000, 3000), exif_rotate=True)   # phone-photo case
    make_board(WORK / "IMG_0002.png", (1200, 800))
    make_board(WORK / "zz_third.jpg", (800, 600))
    make_board(WORK / "extra.png", (900, 700))                          # added in-app with O
    (WORK / "notes.txt").write_text("not an image")


failures = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        failures.append(msg)


def shot(root, name):
    """Save what the canvas is showing, rebuilt from app state (no screen grab)."""
    root.update_idletasks()
    app = shot.app
    if app.preview_base is None:
        return
    img = li.render(app.preview_base, app.labels, app.style, app.scale, full_width=app.full.width)
    d = ImageDraw.Draw(img)
    ox, oy = app.offset
    for item in app.canvas.find_withtag("entry") + app.canvas.find_withtag("sel"):
        kind = app.canvas.type(item)
        xy = app.canvas.coords(item)
        if kind == "window":
            d.rectangle([xy[0] - ox - 60, xy[1] - oy - 14, xy[0] - ox + 60, xy[1] - oy + 14], outline="magenta", width=3)
        elif kind == "line":
            d.line([xy[0] - ox, xy[1] - oy, xy[2] - ox, xy[3] - oy], fill="magenta", width=3)
        elif kind == "rectangle":
            d.rectangle([xy[0] - ox, xy[1] - oy, xy[2] - ox, xy[3] - oy], outline="cyan", width=2)
    img.save(SHOTS / f"{name}.png")


def run():
    setup()
    style = li.Style.load()
    f1, f2, f3, f4 = (WORK / n for n in ("IMG_0001.jpg", "IMG_0002.png", "zz_third.jpg", "extra.png"))
    folder = li.list_images([WORK], style)
    check([p.name for p in folder] == ["extra.png", "IMG_0001.jpg", "IMG_0002.png", "zz_third.jpg"],
          f"folder listing skips non-images: {[p.name for p in folder]}")
    picked = li.list_images([f2, f1, f2, WORK / "notes.txt"], style)
    check([p.name for p in picked] == ["IMG_0002.png", "IMG_0001.jpg"],
          f"picked files keep their order, drop duplicates and non-images: {[p.name for p in picked]}")
    images = li.list_images([f1, f2, f3], style)

    # dialogs are replaced so the test never opens a native window
    li.ask_for_images = lambda: [f4]
    li.colorchooser.askcolor = lambda **kw: ((255, 0, 255), "#ff00ff")

    root = tk.Tk()
    root.geometry("1400x900+3000+3000")   # off-screen: must not disturb the user
    app = li.App(root, images, style)
    shot.app = app
    c = app.canvas

    def disp(fx, fy):
        """display coords for a fractional position on the current full image"""
        return app.to_display(app.full.width * fx, app.full.height * fy)

    steps = []

    def at(ms, fn):
        steps.append((ms, fn))

    def key(sym):
        c.focus_set()
        root.update()
        c.event_generate("<Key>", keysym=sym)  # root binding via bindtags

    def click(fx, fy):
        x, y = disp(fx, fy)
        c.event_generate("<ButtonPress-1>", x=x, y=y)
        c.event_generate("<ButtonRelease-1>", x=x, y=y)

    def double_click(fx, fy):
        x, y = disp(fx, fy)
        c.event_generate("<ButtonPress-1>", x=x, y=y)
        c.event_generate("<ButtonRelease-1>", x=x, y=y)
        c.event_generate("<ButtonPress-1>", x=x, y=y)
        app.on_double(SimpleNamespace(x=x, y=y))   # Tk cannot synthesize <Double-Button-1>
        c.event_generate("<ButtonRelease-1>", x=x, y=y)

    def drag(fx0, fy0, fx1, fy1):
        x0, y0 = disp(fx0, fy0)
        x1, y1 = disp(fx1, fy1)
        c.event_generate("<ButtonPress-1>", x=x0, y=y0)
        for i in range(1, 6):
            c.event_generate("<B1-Motion>", x=x0 + (x1 - x0) * i // 5, y=y0 + (y1 - y0) * i // 5)
        c.event_generate("<ButtonRelease-1>", x=x1, y=y1)

    def type_and_enter(text, replace=False):
        check(app.entry is not None, f"entry opened for '{text}'")
        if app.entry is not None:
            if replace:
                app.entry.delete(0, "end")
            app.entry.insert(0, text)
            app.entry.focus_set()          # Tk routes key events to the focus widget
            root.update()
            app.entry.event_generate("<Return>")

    def near(a, b, tol=3):
        return abs(a - b) < tol

    t = [0]

    def nxt(gap=100):
        t[0] += gap
        return t[0]

    # ---- image 1: EXIF-rotated 4000x3000 jpg ---------------------------------
    at(nxt(300), lambda: check(app.full.size == (4000, 3000), f"EXIF orientation applied: {app.full.size}"))
    at(t[0], lambda: check(app.scale < 1, f"large image scaled to fit: scale={app.scale:.3f}"))
    at(nxt(), lambda: shot(root, "01_blank"))
    at(nxt(), lambda: click(0.36, 0.38))
    at(nxt(), lambda: shot(root, "02_entry_open"))
    at(nxt(), lambda: type_and_enter("R1 10k"))
    at(nxt(), lambda: check(len(app.labels) == 1 and app.labels[0].tip is None, "plain click label added"))
    at(t[0], lambda: check(near(app.labels[0].x, 0.36 * 4000) and near(app.labels[0].y, 0.38 * 3000),
                           f"label at click position in image px: ({app.labels[0].x:.0f},{app.labels[0].y:.0f})"))
    # arrow: press on the LED (0.62,0.435), release where text sits (0.80,0.30)
    at(nxt(), lambda: drag(0.62, 0.435, 0.80, 0.30))
    at(nxt(), lambda: shot(root, "03_arrow_entry_open"))

    def entry_check():
        items = app.canvas.find_withtag("entry")
        kinds = sorted(app.canvas.type(i) for i in items)
        win = [i for i in items if app.canvas.type(i) == "window"][0]
        wx, wy = app.canvas.coords(win)
        ex, ey = disp(0.80, 0.30)
        check(kinds == ["line", "window"] and abs(wx - ex) <= 1 and abs(wy - ey) <= 1,
              f"entry box sits at the release point with a preview arrow: {kinds} {(wx, wy)} vs {(ex, ey)}")
    at(nxt(), entry_check)
    at(nxt(), lambda: type_and_enter("LED (red)"))
    at(nxt(), lambda: check(len(app.labels) == 2 and app.labels[1].tip is not None, "drag label has arrow tip"))
    at(t[0], lambda: check(near(app.labels[1].tip[0], 0.62 * 4000), "arrow tip at press point"))
    # typo, then undo it
    at(nxt(), lambda: click(0.50, 0.75))
    at(nxt(), lambda: type_and_enter("oops"))
    at(nxt(), lambda: key("z"))
    at(nxt(), lambda: check(len(app.labels) == 2 and app.labels[-1].text == "LED (red)", "Z undoes last label"))
    # empty entry + Enter adds nothing
    at(nxt(), lambda: click(0.50, 0.75))
    at(nxt(), lambda: type_and_enter(""))
    at(nxt(), lambda: check(len(app.labels) == 2, "empty text adds no label"))
    # Esc cancels
    at(nxt(), lambda: click(0.50, 0.75))
    at(nxt(), lambda: app.entry.event_generate("<Escape>"))
    at(nxt(), lambda: check(app.entry is None and len(app.labels) == 2, "Esc cancels entry"))
    # clicking elsewhere while typing commits the current one
    at(nxt(), lambda: click(0.52, 0.605))
    at(nxt(), lambda: app.entry.insert(0, "555 timer"))
    at(nxt(), lambda: click(0.20, 0.30))
    at(nxt(), lambda: check(len(app.labels) == 3 and app.labels[-1].text == "555 timer" and app.entry is not None,
                            "click while typing commits then opens a new entry"))
    at(nxt(), lambda: type_and_enter("VCC"))
    # 's' typed INTO an entry must not trigger save
    at(nxt(), lambda: click(0.40, 0.72))
    at(nxt(), lambda: app.entry.event_generate("<Key>", keysym="s"))
    at(nxt(), lambda: check(app.index == 0 and not li.output_path(f1, style).exists(),
                            "typing 's' in the entry does not save"))
    at(nxt(), lambda: type_and_enter("GND wire"))
    at(nxt(), lambda: shot(root, "04_five_labels"))

    # ---- moving, selecting, editing, recolouring, deleting --------------------
    at(nxt(), lambda: drag(0.36, 0.38, 0.46, 0.48))          # grab "R1 10k" by its centre and move it
    at(nxt(), lambda: check(app.entry is None and len(app.labels) == 5, "dragging a label opens no entry"))
    at(t[0], lambda: check(near(app.labels[0].x, 0.46 * 4000) and near(app.labels[0].y, 0.48 * 3000),
                           f"label moved to the drop point: ({app.labels[0].x:.0f},{app.labels[0].y:.0f})"))
    at(t[0], lambda: check(app.selected == 0 and len(c.find_withtag("sel")) == 1, "moved label is selected and highlighted"))
    at(nxt(), lambda: shot(root, "05_after_move"))
    at(nxt(), lambda: drag(0.62, 0.435, 0.62, 0.50))         # grab the LED arrow tip and move it down
    at(nxt(), lambda: check(near(app.labels[1].tip[0], 0.62 * 4000) and near(app.labels[1].tip[1], 0.50 * 3000),
                            f"arrow tip dragged: {tuple(round(v) for v in app.labels[1].tip)}"))
    at(t[0], lambda: check(near(app.labels[1].x, 0.80 * 4000) and near(app.labels[1].y, 0.30 * 3000),
                           "text stays put while the tip moves"))
    at(nxt(), lambda: click(0.46, 0.48))                     # plain click on a label selects it
    at(nxt(), lambda: check(app.entry is None and app.selected == 0, "click on a label selects without an entry"))
    at(nxt(), lambda: key("c"))
    at(nxt(), lambda: check(app.labels[0].fill == li.COLOURS[1] and app.style.fill == li.COLOURS[0],
                            "C with a selection recolours only that label"))
    at(nxt(), lambda: key("k"))
    at(nxt(), lambda: check(app.labels[0].fill == "#FF00FF" and app.labels[0].outline == "#FFFFFF",
                            f"K picks a custom colour with auto outline: {app.labels[0].fill}/{app.labels[0].outline}"))
    at(nxt(), lambda: key("Escape"))
    at(nxt(), lambda: check(app.selected is None and root.winfo_exists(), "Esc clears the selection"))
    at(nxt(), lambda: click(0.52, 0.605))                    # select "555 timer" ...
    at(nxt(), lambda: key("Delete"))                          # ... and delete it
    at(nxt(), lambda: check([l.text for l in app.labels] == ["R1 10k", "LED (red)", "VCC", "GND wires"],
                            f"Delete removes the selected label: {[l.text for l in app.labels]}"))
    at(nxt(), lambda: click(0.52, 0.605))                    # put it back
    at(nxt(), lambda: type_and_enter("555 timer"))
    at(nxt(), lambda: double_click(0.20, 0.30))              # edit "VCC"
    at(nxt(), lambda: check(app.entry is not None and app.entry.get() == "VCC" and app.editing == 2,
                            "double-click opens the label's text for editing"))
    at(nxt(), lambda: type_and_enter("VCC 5V", replace=True))
    at(nxt(), lambda: check([l.text for l in app.labels] == ["R1 10k", "LED (red)", "VCC 5V", "GND wires", "555 timer"],
                            f"edited text replaces the old label: {[l.text for l in app.labels]}"))
    at(nxt(), lambda: key("Escape"))

    # ---- size and colour for new labels ---------------------------------------
    at(nxt(), lambda: key("plus"))
    at(nxt(), lambda: key("plus"))
    at(nxt(), lambda: check(abs(app.style.font_pct - 3.5) < 1e-6, f"+ grows font: {app.style.font_pct}"))
    at(nxt(), lambda: key("minus"))
    at(nxt(), lambda: check(abs(app.style.font_pct - 3.25) < 1e-6, f"- shrinks font: {app.style.font_pct}"))
    at(t[0], lambda: check(json.loads(li.CONFIG_PATH.read_text())["font_pct"] == 3.25, "font size persisted to config"))
    at(nxt(), lambda: key("c"))
    at(nxt(), lambda: check(app.style.fill == li.COLOURS[1], f"C with nothing selected sets the colour for new labels: {app.style.fill}"))
    at(t[0], lambda: check(json.loads(li.CONFIG_PATH.read_text())["fill"] == li.COLOURS[1], "colour persisted to config"))
    at(nxt(), lambda: key("c"))   # black
    at(nxt(), lambda: check(app.style.outline == "#FFFFFF", "black text gets white outline"))
    at(nxt(), lambda: click(0.75, 0.75))
    at(nxt(), lambda: type_and_enter("black label"))
    at(nxt(), lambda: check(app.labels[-1].fill == "#000000" and app.labels[0].fill == "#FF00FF",
                            "new label takes the current colour; old labels keep theirs"))
    at(nxt(), lambda: shot(root, "06_mixed_colours"))
    at(nxt(), lambda: key("c")); at(nxt(50), lambda: key("c")); at(nxt(50), lambda: key("c")); at(nxt(50), lambda: key("c"))
    at(nxt(), lambda: check(app.style.fill == li.COLOURS[0], "colour cycle wraps to yellow"))
    # Q with unsaved work warns first
    at(nxt(), lambda: key("q"))
    at(nxt(), lambda: check(root.winfo_exists(), "Q with unsaved labels does not quit"))
    # save + next
    at(nxt(), lambda: key("s"))
    at(nxt(200), lambda: check(app.index == 1 and app.path.name == "IMG_0002.png", "S saves and advances"))
    at(t[0], lambda: check(li.output_path(f1, style).exists(), "output jpg written"))
    at(t[0], lambda: check(li.sidecar_path(f1).exists(), "sidecar json written"))
    at(t[0], lambda: check(len(app.labels) == 0 and not app.dirty and app.selected is None, "next image starts clean"))
    # image 2: one plain label, one arrow, then go back and check preload
    at(nxt(), lambda: click(0.36, 0.40))
    at(nxt(), lambda: type_and_enter("220 Ω"))
    at(nxt(), lambda: drag(0.515, 0.60, 0.30, 0.80))
    at(nxt(), lambda: type_and_enter("ATmega328"))
    at(nxt(), lambda: shot(root, "07_image2_labels"))
    at(nxt(), lambda: key("s"))
    at(nxt(200), lambda: check(app.index == 2, "advanced to image 3"))
    at(nxt(), lambda: key("p"))
    at(nxt(200), lambda: check(app.index == 1 and [l.text for l in app.labels] == ["220 Ω", "ATmega328"],
                               f"P goes back and reloads saved labels: {[l.text for l in app.labels]}"))
    at(t[0], lambda: check("[already labeled]" in app.status.cget("text"), "status marks already-labeled image"))
    at(nxt(), lambda: key("p"))
    at(nxt(200), lambda: check(len(app.labels) == 6 and app.labels[0].fill == "#FF00FF",
                               f"image 1 labels reload with their colours: {len(app.labels)}"))
    at(nxt(), lambda: key("n")); at(nxt(200), lambda: key("n"))
    at(nxt(200), lambda: check(app.index == 2, "N N returns to image 3"))
    at(nxt(), lambda: key("n"))
    at(nxt(), lambda: check(app.index == 2 and "No more" in app.status.cget("text"), "N past the end just flashes"))
    # O adds more images to the queue
    at(nxt(), lambda: key("o"))
    at(nxt(), lambda: check(len(app.images) == 4 and app.images[-1] == f4 and "Added 1" in app.status.cget("text"),
                            "O appends the picked image to the queue"))
    at(nxt(), lambda: key("o"))
    at(nxt(), lambda: check(len(app.images) == 4 and "Nothing new" in app.status.cget("text"), "O ignores images already queued"))
    at(nxt(), lambda: click(0.5, 0.5))
    at(nxt(), lambda: type_and_enter("third"))
    at(nxt(), lambda: key("s"))
    at(nxt(200), lambda: check(app.index == 3 and app.path == f4, "S moves on to the image added with O"))
    at(nxt(), lambda: click(0.5, 0.5))
    at(nxt(), lambda: app.entry.insert(0, "last one"))
    at(nxt(), lambda: key("s"))   # S while typing goes to the text box, not to save
    at(nxt(), lambda: check(app.entry is not None and root.winfo_exists() and app.index == 3, "S while typing does not save"))
    at(nxt(), lambda: (app.entry.focus_set(), root.update(), app.entry.event_generate("<Return>")))
    at(nxt(), lambda: key("s"))   # last image -> app closes itself
    at(nxt(200), lambda: check(not root.winfo_exists(), "saving the last image closes the app"))
    at(nxt(), root.quit)

    for ms, fn in steps:
        def wrap(fn=fn):
            try:
                fn()
            except Exception as ex:  # noqa: BLE001
                check(False, f"exception in step: {ex!r}")
        root.after(ms, wrap)
    root.mainloop()

    # ---- offline checks on the saved files -----------------------------------
    im = Image.open(li.output_path(f1, style))
    check(im.size == (4000, 3000), f"saved image keeps full resolution and upright orientation: {im.size}")
    sc = json.loads(li.sidecar_path(f1).read_text("utf-8"))
    check([l["text"] for l in sc["labels"]] == ["R1 10k", "LED (red)", "VCC 5V", "GND wires", "555 timer", "black label"],
          "sidecar has the six labels in order")
    check([l["fill"] for l in sc["labels"]] == ["#FF00FF", "#FFEB3B", "#FFEB3B", "#FFEB3B", "#FFEB3B", "#000000"],
          f"sidecar keeps per-label colours: {[l['fill'] for l in sc['labels']]}")
    for i, l in enumerate(sc["labels"]):
        box = (int(l["x"] - 700), int(l["y"] - 300), int(l["x"] + 700), int(l["y"] + 300))
        im.crop(box).save(SHOTS / f"out1_crop_{i}_{l['text'].replace(' ', '_').replace('(', '').replace(')', '')}.png")
    im.resize((1333, 1000)).save(SHOTS / "out1_full_small.png")
    out2 = Image.open(li.output_path(f2, style))
    out2.save(SHOTS / "out2_full.png")
    check(out2.size == (1200, 800), "png output full size")
    check(li.output_path(f3, style).exists() and li.output_path(f4, style).exists(), "third and fourth outputs exist")
    sc4 = json.loads(li.sidecar_path(f4).read_text("utf-8"))
    check([l["text"] for l in sc4["labels"]] == ["last one"], "fourth image sidecar written")
    again = li.list_images([WORK], style)
    check([p.name for p in again] == [p.name for p in folder], "re-listing does not pick up *_labeled outputs")

    # ---- main() entry point, dialogs stubbed, window off-screen ---------------
    orig_geometry, orig_loop = tk.Tk.geometry, tk.Tk.mainloop
    tk.Tk.geometry = lambda self, g=None: orig_geometry(self, "1000x700+3000+3000")

    def fake_loop(self, n=0):
        self.after(300, self.destroy)
        orig_loop(self, n)
    tk.Tk.mainloop = fake_loop
    try:
        check(li.main([str(f2), str(f1)]) == 0, "main() accepts a list of files")
        check(li.main([str(WORK)]) == 0, "main() accepts a folder")
        li.ask_for_images = lambda: []
        check(li.main([]) == 1, "main() with no files and a cancelled dialog exits quietly")
        li.ask_for_images = lambda: [f3]
        check(li.main([]) == 0, "main() with no args uses the file dialog")
        check(li.main([r"C:\nope\nothing.jpg"]) == 1, "main() reports a missing file")
    finally:
        tk.Tk.geometry, tk.Tk.mainloop = orig_geometry, orig_loop
    print()
    print("FAILURES:", failures if failures else "none")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(run())
