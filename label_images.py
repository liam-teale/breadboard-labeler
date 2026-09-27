#!/usr/bin/env python3
"""
label_images.py - click-and-type labels onto photos.

Usage:
    python label_images.py                     # pick the photos in a file dialog
    python label_images.py a.jpg b.jpg ...     # or list them
    python label_images.py PATH/TO/FOLDER      # or give a folder

A label has three parts: the text on a solid coloured box, a solid square on
the part it refers to, and a line joining them.

Mouse:
    click on a part         square there, text placed beside it (drag it later)
    drag from a part        press on the part, drag to where the text should sit
    shift-click             text only, no square or line
    drag a label            move the text (its square stays put)
    drag a square           move the square
    click a label           select it (for Delete / recolour / resize)
    Ctrl+Z / Ctrl+Y         undo / redo (same as Z / Y)
    double-click a label    edit its text
Keys (when not typing a label):
    Enter / Esc      place / cancel the label you are typing
    S                save this image and go to the next one
    N / P            next / previous image without saving
    O                open more images
    Z / Y            undo / redo
    Delete           delete the selected label
    + / -            bigger / smaller text (remembered for next time)
    [ / ]            smaller / bigger square (selected label, or default for new ones)
    C                cycle preset colours (applies to the selected label, or to new labels)
    K                pick any colour (same)
    Q                quit

Output: <name>_labeled.<ext> next to the original. Labels are also kept in
<folder>/.labeler/<name>.json so reopening an image restores them.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import sys
import tkinter as tk
from dataclasses import asdict, dataclass
from pathlib import Path
from tkinter import colorchooser, filedialog

from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageTk

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
CONFIG_PATH = Path.home() / ".breadboard_labeler.json"
SIDECAR_DIR = ".labeler"

COLOURS = ["#FFEB3B", "#FFFFFF", "#000000", "#FF3B30", "#00E5FF", "#76FF03"]
FONT_CANDIDATES = [
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def outline_for(fill: str) -> str:
    """Black outline on light colours, white on dark ones."""
    try:
        r, g, b = (int(fill[i:i + 2], 16) / 255 for i in (1, 3, 5))
    except (ValueError, IndexError):
        return "#000000"
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return "#000000" if lum > 0.5 else "#FFFFFF"


# --------------------------------------------------------------------------- #
# Style (persisted between runs) and labels (persisted per image)
# --------------------------------------------------------------------------- #
@dataclass
class Style:
    font_pct: float = 3.0        # text height as % of image width
    marker_pct: float = 2.5      # square side as % of image width
    fill: str = COLOURS[0]
    suffix: str = "_labeled"

    @property
    def outline(self) -> str:
        return outline_for(self.fill)

    @classmethod
    def load(cls, overrides: dict | None = None) -> "Style":
        data: dict = {}
        if CONFIG_PATH.exists():
            try:
                data = json.loads(CONFIG_PATH.read_text("utf-8"))
            except (OSError, json.JSONDecodeError):
                data = {}
        data.update({k: v for k, v in (overrides or {}).items() if v is not None})
        known = {k: data[k] for k in cls.__dataclass_fields__ if k in data}
        return cls(**known)

    def save(self) -> None:
        try:
            CONFIG_PATH.write_text(json.dumps(asdict(self), indent=2), "utf-8")
        except OSError:
            pass


@dataclass
class Label:
    x: float                                  # text centre, original-image pixels
    y: float
    text: str
    tip: tuple[float, float] | None = None    # square centre, or None for text only
    fill: str = COLOURS[0]
    marker: float = 2.5                       # square side as % of image width

    @property
    def outline(self) -> str:
        return outline_for(self.fill)


def sidecar_path(image_path: Path) -> Path:
    return image_path.parent / SIDECAR_DIR / (image_path.stem + ".json")


def output_path(image_path: Path, style: Style) -> Path:
    ext = image_path.suffix
    if ext.lower() not in {".jpg", ".jpeg", ".png"}:
        ext = ".png"
    return image_path.with_name(image_path.stem + style.suffix + ext)


def is_image(p: Path, style: Style) -> bool:
    return p.suffix.lower() in IMAGE_EXTS and not p.stem.endswith(style.suffix)


def list_images(targets: list[Path], style: Style) -> list[Path]:
    """Files are kept in the order given; a folder expands to its images sorted by name."""
    out: list[Path] = []
    for t in targets:
        if t.is_dir():
            out += [p for p in sorted(t.iterdir(), key=lambda p: p.name.lower()) if is_image(p, style)]
        elif t.is_file() and is_image(t, style):
            out.append(t)
    seen: set[Path] = set()
    unique = []
    for p in out:
        rp = p.resolve()
        if rp not in seen:
            seen.add(rp)
            unique.append(p)
    return unique


def ask_for_images() -> list[Path]:
    names = filedialog.askopenfilenames(
        title="Pick the photos to label (Ctrl/Shift-click for several)",
        filetypes=[("Images", "*.jpg *.jpeg *.png *.bmp *.webp *.tif *.tiff"), ("All files", "*.*")])
    return [Path(n) for n in names]


# --------------------------------------------------------------------------- #
# Rendering (shared by the on-screen preview and the saved file)
# --------------------------------------------------------------------------- #
_font_cache: dict[tuple[str, int], object] = {}


def find_font_file() -> str | None:
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return f
    return None


def get_font(px: int):
    px = max(6, int(px))
    path = find_font_file()
    key = (path or "default", px)
    if key not in _font_cache:
        if path:
            _font_cache[key] = ImageFont.truetype(path, px)
        else:
            _font_cache[key] = ImageFont.load_default(size=px)
    return _font_cache[key]


def metrics(full_width: int, style: Style, scale: float) -> tuple[int, int, int]:
    """(font px, box padding px, leader line px) for an image of full_width shown at scale."""
    font_px = max(6, round(full_width * style.font_pct / 100 * scale))
    return font_px, max(2, round(font_px * 0.3)), max(2, round(font_px * 0.16))


def render(img: Image.Image, labels: list[Label], style: Style, scale: float = 1.0,
           full_width: int | None = None, boxes_out: list | None = None) -> Image.Image:
    """Draw labels onto a copy of img. Label coordinates are original pixels;
    scale maps them onto img (which may be a resized preview). If boxes_out is
    given, it receives each label's text bbox in img pixels (for hit-testing)."""
    out = img.copy()
    draw = ImageDraw.Draw(out)
    font_px, pad, line_w = metrics(full_width or img.width, style, scale)
    font = get_font(font_px)
    edge = max(1, round(line_w * 0.4))

    for lb in labels:
        cx, cy = lb.x * scale, lb.y * scale
        tb = draw.textbbox((cx, cy), lb.text, font=font, anchor="mm")
        box = (tb[0] - pad, tb[1] - pad * 0.6, tb[2] + pad, tb[3] + pad * 0.6)
        if boxes_out is not None:
            boxes_out.append(box)
        if lb.tip is not None:
            tx, ty = lb.tip[0] * scale, lb.tip[1] * scale
            side = max(4, (full_width or img.width) * lb.marker / 100 * scale)
            _draw_leader(draw, box, (cx, cy), (tx, ty), side, line_w, edge, lb.fill, lb.outline)
        draw.rounded_rectangle(box, radius=pad * 0.5, fill=lb.fill, outline=lb.outline, width=edge)
        draw.text((cx, cy), lb.text, font=font, anchor="mm", fill=lb.outline)
    return out


def _draw_leader(draw, box, centre, tip, side: float, w: int, edge: int, fill: str, outline: str) -> None:
    """Solid square of the given side centred on tip, joined to the text box by a line."""
    cx, cy = centre
    tx, ty = tip
    half = side / 2
    dx, dy = tx - cx, ty - cy
    dist = math.hypot(dx, dy)
    if dist >= 1:
        # line runs from where the centre->tip ray leaves the text box ...
        half_w = (box[2] - box[0]) / 2
        half_h = (box[3] - box[1]) / 2
        t0 = min(half_w / abs(dx) if dx else math.inf, half_h / abs(dy) if dy else math.inf, 1.0)
        sx, sy = cx + dx * t0, cy + dy * t0
        # ... to where it enters the square
        t1 = min(half / abs(dx) if dx else math.inf, half / abs(dy) if dy else math.inf, 1.0)
        ex, ey = tx - dx * t1, ty - dy * t1
        if math.hypot(ex - sx, ey - sy) > w:
            draw.line([(sx, sy), (ex, ey)], fill=outline, width=w + 2 * edge)
            draw.line([(sx, sy), (ex, ey)], fill=fill, width=w)
    draw.rectangle([tx - half, ty - half, tx + half, ty + half], fill=fill, outline=outline, width=edge)


# --------------------------------------------------------------------------- #
# The app
# --------------------------------------------------------------------------- #
class App:
    DRAG_THRESHOLD = 6  # display pixels

    def __init__(self, root: tk.Tk, images: list[Path], style: Style, start: int = 0):
        self.root = root
        self.images = images
        self.style = style
        self.index = max(0, min(start, len(images) - 1))
        self.labels: list[Label] = []
        self.boxes: list[tuple[float, float, float, float]] = []   # canvas-space text boxes
        self.selected: int | None = None
        self.entry: tk.Entry | None = None
        self.pending = None                 # (pos, tip) for a label being typed
        self.editing: int | None = None     # label index whose text is being edited
        self.press: tuple[int, int] | None = None
        self.mode: str | None = None        # "new" | "move" | "tip"
        self.grab_offset = (0.0, 0.0)
        self.moved = False
        self.rubber = None
        self.scale = 1.0
        self.offset = (0, 0)
        self.full: Image.Image | None = None
        self.preview_base: Image.Image | None = None
        self.photo: ImageTk.PhotoImage | None = None
        self.dirty = False
        self.saved_count = 0
        self.undo_stack: list[list[Label]] = []
        self.redo_stack: list[list[Label]] = []
        self._flash_job = None
        self._resize_job = None

        root.title("Breadboard labeler")
        self.status = tk.Label(root, anchor="w", font=("Segoe UI", 10), padx=8, pady=4,
                               bg="#222", fg="#eee")
        self.status.pack(fill="x", side="top")
        self.canvas = tk.Canvas(root, bg="#111", highlightthickness=0, cursor="crosshair")
        self.canvas.pack(fill="both", expand=True)

        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.canvas.bind("<Double-Button-1>", self.on_double)
        self.canvas.bind("<Configure>", self.on_resize)
        root.bind("<Key>", self.on_key)
        root.protocol("WM_DELETE_WINDOW", self.quit)

        self.load(self.index)

    # ---- image navigation -------------------------------------------------- #
    @property
    def path(self) -> Path:
        return self.images[self.index]

    def load(self, index: int) -> None:
        self.cancel_entry()
        self.index = index
        self.selected = None
        img = Image.open(self.path)
        img = ImageOps.exif_transpose(img)
        self.full = img.convert("RGB")
        self.labels = self.load_sidecar()
        self.undo_stack.clear()
        self.redo_stack.clear()
        self.dirty = False
        self.preview_base = None
        self.refresh()

    # ---- undo / redo ------------------------------------------------------- #
    def snapshot(self) -> None:
        """Call before any change to the labels."""
        self.undo_stack.append(copy.deepcopy(self.labels))
        del self.undo_stack[:-100]
        self.redo_stack.clear()

    def undo(self) -> None:
        if not self.undo_stack:
            self.flash("Nothing to undo.")
            return
        self.redo_stack.append(copy.deepcopy(self.labels))
        self.labels = self.undo_stack.pop()
        self.selected = None
        self.dirty = True
        self.refresh()

    def redo(self) -> None:
        if not self.redo_stack:
            self.flash("Nothing to redo.")
            return
        self.undo_stack.append(copy.deepcopy(self.labels))
        self.labels = self.redo_stack.pop()
        self.selected = None
        self.dirty = True
        self.refresh()

    def load_sidecar(self) -> list[Label]:
        sc = sidecar_path(self.path)
        if not sc.exists():
            return []
        try:
            data = json.loads(sc.read_text("utf-8"))
            return [Label(d["x"], d["y"], d["text"],
                          tuple(d["tip"]) if d.get("tip") else None,
                          d.get("fill", self.style.fill),
                          d.get("marker", self.style.marker_pct)) for d in data["labels"]]
        except (OSError, KeyError, json.JSONDecodeError, TypeError):
            return []

    def save_sidecar(self) -> None:
        sc = sidecar_path(self.path)
        sc.parent.mkdir(exist_ok=True)
        sc.write_text(json.dumps({"labels": [asdict(l) for l in self.labels]}, indent=2), "utf-8")

    def save(self) -> Path:
        assert self.full is not None
        out = output_path(self.path, self.style)
        final = render(self.full, self.labels, self.style)
        if out.suffix.lower() in {".jpg", ".jpeg"}:
            final.save(out, quality=95)
        else:
            final.save(out)
        self.save_sidecar()
        self.dirty = False
        self.saved_count += 1
        return out

    def save_and_next(self) -> None:
        self.commit_entry()
        out = self.save()
        print(f"saved {out}")
        if self.index + 1 < len(self.images):
            self.load(self.index + 1)
        else:
            print(f"All {len(self.images)} image(s) done.")
            self.quit(force=True)

    def step(self, delta: int) -> None:
        new = self.index + delta
        if 0 <= new < len(self.images):
            self.load(new)
        else:
            self.flash("No more images that way." if delta > 0 else "This is the first image.")

    def open_more(self) -> None:
        have = {q.resolve() for q in self.images}
        new = [p for p in list_images(ask_for_images(), self.style) if p.resolve() not in have]
        if new:
            self.images += new
            self.flash(f"Added {len(new)} image(s); {len(self.images)} in the queue.")
        else:
            self.flash("Nothing new added.")

    def quit(self, force: bool = False) -> None:
        if self.dirty and not force:
            self.flash("Unsaved labels! Press S to save, or Q again to discard.")
            self.dirty = False  # second Q quits
            return
        self.root.destroy()

    # ---- drawing ----------------------------------------------------------- #
    def compute_layout(self) -> None:
        assert self.full is not None
        cw = max(1, self.canvas.winfo_width())
        ch = max(1, self.canvas.winfo_height())
        self.scale = min(cw / self.full.width, ch / self.full.height, 1.0)
        dw = max(1, round(self.full.width * self.scale))
        dh = max(1, round(self.full.height * self.scale))
        self.offset = ((cw - dw) // 2, (ch - dh) // 2)
        if self.preview_base is None or self.preview_base.size != (dw, dh):
            self.preview_base = self.full.resize((dw, dh), Image.LANCZOS)

    def refresh(self) -> None:
        if self.full is None or self.canvas.winfo_width() < 2:
            return
        self.compute_layout()
        assert self.preview_base is not None
        boxes: list = []
        preview = render(self.preview_base, self.labels, self.style, self.scale,
                         full_width=self.full.width, boxes_out=boxes)
        ox, oy = self.offset
        self.boxes = [(b[0] + ox, b[1] + oy, b[2] + ox, b[3] + oy) for b in boxes]
        self.photo = ImageTk.PhotoImage(preview, master=self.canvas)
        self.canvas.delete("img")
        self.canvas.delete("sel")
        self.canvas.create_image(self.offset, image=self.photo, anchor="nw", tags="img")
        self.canvas.tag_lower("img")
        if self.selected is not None and self.selected < len(self.boxes):
            x0, y0, x1, y1 = self.boxes[self.selected]
            self.canvas.create_rectangle(x0 - 4, y0 - 4, x1 + 4, y1 + 4, outline="#00E5FF",
                                         dash=(5, 3), width=2, tags="sel")
        self.update_status()

    def on_resize(self, e=None) -> None:
        # resizing fires many Configure events; rescale once things settle
        if self._resize_job is not None:
            self.root.after_cancel(self._resize_job)
        self._resize_job = self.root.after(80, self.refresh)

    def update_status(self, extra: str = "") -> None:
        out = output_path(self.path, self.style)
        done = "  [already labeled]" if out.exists() else ""
        sel = f"  selected: \"{self.labels[self.selected].text}\"" if self.selected is not None else ""
        msg = (f"{self.index + 1}/{len(self.images)}  {self.path.name}{done}    "
               f"labels: {len(self.labels)}{'*' if self.dirty else ''}{sel}    "
               f"text {self.style.font_pct:.2g}%  square {self.style.marker_pct:.2g}%  colour {self.style.fill}    "
               f"|  click part = label   drag = choose text spot   shift-click = text only   dbl-click = edit   "
               f"S save+next   N/P   O open   Z/Y undo/redo   Del   +/- text   [/] square   C/K colour   Q quit")
        if extra:
            msg = extra + "    |    " + msg
        self.status.config(text=msg)

    def flash(self, text: str) -> None:
        self.update_status(text)
        if self._flash_job is not None:
            self.root.after_cancel(self._flash_job)
        self._flash_job = self.root.after(2500, self.update_status)

    # ---- coordinate helpers ------------------------------------------------ #
    def to_image(self, x: float, y: float) -> tuple[float, float]:
        assert self.full is not None
        ix = (x - self.offset[0]) / self.scale
        iy = (y - self.offset[1]) / self.scale
        ix = min(max(ix, 0), self.full.width - 1)
        iy = min(max(iy, 0), self.full.height - 1)
        return ix, iy

    def to_display(self, ix: float, iy: float) -> tuple[int, int]:
        return round(ix * self.scale + self.offset[0]), round(iy * self.scale + self.offset[1])

    def marker_disp(self, lb: Label) -> float:
        """Square side in display pixels."""
        assert self.full is not None
        return max(4, self.full.width * lb.marker / 100 * self.scale)

    def hit_tip(self, x: int, y: int) -> int | None:
        assert self.full is not None
        _, _, line_w = metrics(self.full.width, self.style, self.scale)
        for i in range(len(self.labels) - 1, -1, -1):        # topmost first
            lb = self.labels[i]
            if lb.tip is not None:
                tx, ty = self.to_display(*lb.tip)
                reach = max(12, self.marker_disp(lb) / 2 + line_w)
                if abs(x - tx) <= reach and abs(y - ty) <= reach:
                    return i
        return None

    def default_text_pos(self, tip: tuple[float, float]) -> tuple[float, float]:
        """Where a plain click puts the text: up and to the right of the square,
        flipped if that would run off the image."""
        assert self.full is not None
        w, h = self.full.width, self.full.height
        dx = -0.09 * w if tip[0] > 0.72 * w else 0.09 * w
        dy = 0.06 * w if tip[1] < 0.12 * h else -0.06 * w
        return min(max(tip[0] + dx, 0), w - 1), min(max(tip[1] + dy, 0), h - 1)

    def hit_label(self, x: int, y: int) -> int | None:
        pad = 6
        for i in range(len(self.boxes) - 1, -1, -1):
            x0, y0, x1, y1 = self.boxes[i]
            if x0 - pad <= x <= x1 + pad and y0 - pad <= y <= y1 + pad:
                return i
        return None

    # ---- mouse ------------------------------------------------------------- #
    def on_press(self, e) -> None:
        if self.entry is not None:
            self.commit_entry()     # finish the previous label first
        self.press = (e.x, e.y)
        self.moved = False
        i = self.hit_tip(e.x, e.y)
        if i is not None:
            self.mode, self.selected = "tip", i
        else:
            i = self.hit_label(e.x, e.y)
            if i is not None:
                self.mode, self.selected = "move", i
                lx, ly = self.to_display(self.labels[i].x, self.labels[i].y)
                self.grab_offset = (e.x - lx, e.y - ly)
            else:
                self.mode, self.selected = "new", None
        if self.mode in ("move", "tip"):
            self.snapshot()
        self.refresh()

    def on_drag(self, e) -> None:
        if self.press is None or self.mode is None:
            return
        if not self.moved and math.hypot(e.x - self.press[0], e.y - self.press[1]) < self.DRAG_THRESHOLD:
            return
        self.moved = True
        if self.mode == "new":
            if self.rubber is None:
                self.rubber = self.draw_leader_preview(self.press, (e.x, e.y), self.style.fill,
                                                       self.style.marker_pct, "rubber")
            else:
                self.canvas.coords(self.rubber[0], *self.press, e.x, e.y)
        elif self.mode == "move" and self.selected is not None:
            lb = self.labels[self.selected]
            lb.x, lb.y = self.to_image(e.x - self.grab_offset[0], e.y - self.grab_offset[1])
            self.dirty = True
            self.refresh()
        elif self.mode == "tip" and self.selected is not None:
            self.labels[self.selected].tip = self.to_image(e.x, e.y)
            self.dirty = True
            self.refresh()

    def on_release(self, e) -> None:
        if self.press is None:
            return
        px, py = self.press
        mode, moved = self.mode, self.moved
        self.press, self.mode, self.moved = None, None, False
        if self.rubber is not None:
            self.canvas.delete("rubber")
            self.rubber = None
        if mode in ("move", "tip") and not moved and self.undo_stack:
            self.undo_stack.pop()       # plain click on a label: nothing changed
        if mode != "new" or self.entry is not None:
            return                      # finished a move/tip drag, or a double-click opened the editor
        shift = bool(e.state & 0x1)
        if moved:
            pos, tip = self.to_image(e.x, e.y), self.to_image(px, py)
        elif shift:
            pos, tip = self.to_image(px, py), None
        else:
            tip = self.to_image(px, py)
            pos = self.default_text_pos(tip)
        self.open_entry(pos, tip, self.to_display(*pos))

    def draw_leader_preview(self, text_disp, tip_disp, fill: str, marker_pct: float, tag: str) -> list[int]:
        """Canvas line + square used while dragging or typing; returns the item ids."""
        assert self.full is not None
        half = max(4, self.full.width * marker_pct / 100 * self.scale) / 2
        line = self.canvas.create_line(*text_disp, *tip_disp, fill=fill, width=3, tags=tag)
        box = self.canvas.create_rectangle(tip_disp[0] - half, tip_disp[1] - half,
                                           tip_disp[0] + half, tip_disp[1] + half,
                                           outline=fill, width=3, tags=tag)
        return [line, box]

    def on_double(self, e) -> None:
        i = self.hit_label(e.x, e.y)
        if i is None:
            return
        self.cancel_entry()
        self.press, self.mode = None, None
        self.selected = i
        lb = self.labels[i]
        self.open_entry((lb.x, lb.y), lb.tip, self.to_display(lb.x, lb.y), editing=i)

    # ---- the text entry ---------------------------------------------------- #
    def open_entry(self, pos, tip, anchor_disp, editing: int | None = None) -> None:
        self.pending = (pos, tip)
        self.editing = editing
        assert self.full is not None
        fill = self.labels[editing].fill if editing is not None else self.style.fill
        font_px = max(10, round(self.full.width * self.style.font_pct / 100 * self.scale))
        self.entry = tk.Entry(self.canvas, font=("Arial", -max(12, int(font_px * 0.9)), "bold"),
                              bg="#222", fg=fill, insertbackground=fill,
                              relief="flat", width=12, justify="center")
        self.canvas.create_window(anchor_disp, window=self.entry, anchor="center", tags="entry")
        if tip is not None and editing is None:
            self.draw_leader_preview(anchor_disp, self.to_display(*tip), fill, self.style.marker_pct, "entry")
        if editing is not None:
            self.entry.insert(0, self.labels[editing].text)
            self.entry.select_range(0, "end")
            self._grow_entry()
        self.entry.bind("<Return>", lambda e: self.commit_entry())
        self.entry.bind("<KP_Enter>", lambda e: self.commit_entry())
        self.entry.bind("<Escape>", lambda e: self.cancel_entry())
        self.entry.bind("<KeyRelease>", self._grow_entry)
        self.entry.focus_set()
        self.update_status("Type the label, Enter to place it, Esc to cancel")

    def _grow_entry(self, e=None) -> None:
        if self.entry is not None:
            self.entry.config(width=max(12, len(self.entry.get()) + 2))

    def commit_entry(self) -> None:
        if self.entry is None or self.pending is None:
            return
        text = self.entry.get().strip()
        pos, tip = self.pending
        editing = self.editing
        self.cancel_entry()
        if editing is not None:
            if text != self.labels[editing].text:
                self.snapshot()
            if text:
                self.labels[editing].text = text
            else:
                del self.labels[editing]
                self.selected = None
            self.dirty = True
        elif text:
            self.snapshot()
            self.labels.append(Label(pos[0], pos[1], text, tip, self.style.fill, self.style.marker_pct))
            self.dirty = True
        self.refresh()

    def cancel_entry(self) -> None:
        if self.entry is not None:
            self.entry.destroy()
            self.entry = None
        self.canvas.delete("entry")
        self.pending = None
        self.editing = None
        self.canvas.focus_set()
        if self.full is not None:
            self.update_status()

    # ---- colours ----------------------------------------------------------- #
    def apply_colour(self, fill: str) -> None:
        """Recolour the selected label if there is one, otherwise set the colour for new labels."""
        if self.selected is not None:
            self.snapshot()
            self.labels[self.selected].fill = fill
            self.dirty = True
        else:
            self.style.fill = fill
            self.style.save()
        self.refresh()

    def pick_colour(self) -> None:
        current = self.labels[self.selected].fill if self.selected is not None else self.style.fill
        _, hexcode = colorchooser.askcolor(color=current, title="Label colour", parent=self.root)
        if hexcode:
            self.apply_colour(hexcode.upper())

    def delete_selected(self) -> None:
        if self.selected is not None:
            self.snapshot()
            del self.labels[self.selected]
            self.selected = None
            self.dirty = True
            self.refresh()

    # ---- keys -------------------------------------------------------------- #
    def on_key(self, e) -> None:
        if self.entry is not None:
            return                      # typing a label; leave keys to the entry
        k = e.keysym.lower()
        ch = e.char
        if k == "s":
            self.save_and_next()
        elif k in ("n", "right"):
            self.step(+1)
        elif k in ("p", "left"):
            self.step(-1)
        elif k == "o":
            self.open_more()
        elif k == "z":
            self.undo()
        elif k == "y":
            self.redo()
        elif k in ("delete", "backspace"):
            self.delete_selected()
        elif k == "escape":
            if self.selected is not None:
                self.selected = None
                self.refresh()
            else:
                self.quit()
        elif k == "q":
            self.quit()
        elif ch in ("+", "=") or k in ("plus", "equal", "kp_add"):
            self.style.font_pct = min(15.0, round(self.style.font_pct + 0.25, 2))
            self.style.save()
            self.refresh()
        elif ch in ("-", "_") or k in ("minus", "underscore", "kp_subtract"):
            self.style.font_pct = max(0.5, round(self.style.font_pct - 0.25, 2))
            self.style.save()
            self.refresh()
        elif k in ("bracketleft", "bracketright"):
            delta = 0.25 if k == "bracketright" else -0.25
            if self.selected is not None:
                self.snapshot()
                lb = self.labels[self.selected]
                lb.marker = min(20.0, max(0.5, round(lb.marker + delta, 2)))
                self.dirty = True
            else:
                self.style.marker_pct = min(20.0, max(0.5, round(self.style.marker_pct + delta, 2)))
                self.style.save()
            self.refresh()
        elif k == "c":
            current = self.labels[self.selected].fill if self.selected is not None else self.style.fill
            i = COLOURS.index(current) if current in COLOURS else -1
            self.apply_colour(COLOURS[(i + 1) % len(COLOURS)])
        elif k == "k":
            self.pick_colour()


# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Click-and-type labels onto photos.")
    ap.add_argument("targets", nargs="*", help="image files and/or folders (none: a file dialog opens)")
    ap.add_argument("--size", type=float, dest="font_pct",
                    help="text height as %% of image width (default: last used, else 3)")
    ap.add_argument("--colour", "--color", dest="fill", help="colour for new labels, e.g. #FFEB3B")
    ap.add_argument("--suffix", help="output filename suffix (default _labeled)")
    ap.add_argument("--start", type=int, default=0, help="start at image number (1-based)")
    args = ap.parse_args(argv)
    try:  # folder names with non-ASCII characters must not crash the console output
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    try:  # crisp text on high-DPI Windows displays
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass

    style = Style.load({"font_pct": args.font_pct, "fill": args.fill, "suffix": args.suffix})
    if args.fill:
        style.fill = args.fill.upper()
    targets = [Path(t) for t in args.targets]
    missing = [t for t in targets if not t.exists()]
    if missing:
        print("Not found: " + ", ".join(map(str, missing)), file=sys.stderr)
        return 1

    root = tk.Tk()
    root.withdraw()
    if not targets:
        targets = ask_for_images()
    images = list_images(targets, style) if targets else []
    if not images:
        if targets:
            print("No images to label.", file=sys.stderr)
        root.destroy()
        return 1

    sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
    root.geometry(f"{int(sw * 0.85)}x{int(sh * 0.85)}+{int(sw * 0.07)}+{int(sh * 0.05)}")
    root.deiconify()
    App(root, images, style, start=max(0, args.start - 1))
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
