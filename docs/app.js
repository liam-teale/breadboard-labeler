// Breadboard labeler - browser version.
// A label is: text on a solid coloured box, a solid square on the part it
// refers to, and a line joining them. Everything runs in the browser; photos
// never leave the device.

export const COLOURS = ['#FFEB3B', '#FFFFFF', '#000000', '#FF3B30', '#00E5FF', '#76FF03'];
const STYLE_KEY = 'bbl.style';
const LABELS_KEY = 'bbl.labels';
const DRAG_THRESHOLD = 6;

export function outlineFor(fill) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fill || '');
  if (!m) return '#000000';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#000000' : '#FFFFFF';
}

export function metrics(fullWidth, style, scale) {
  const fontPx = Math.max(6, (fullWidth * style.fontPct) / 100 * scale);
  return { fontPx, pad: Math.max(2, fontPx * 0.3), lineW: Math.max(2, fontPx * 0.16) };
}

function roundRect(ctx, [x0, y0, x1, y1], r) {
  const w = x1 - x0, h = y1 - y0;
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x1, y0, x1, y1, r);
  ctx.arcTo(x1, y1, x0, y1, r);
  ctx.arcTo(x0, y1, x0, y0, r);
  ctx.arcTo(x0, y0, x1, y0, r);
  ctx.closePath();
}

function drawLeader(ctx, box, cx, cy, tx, ty, side, lineW, edge, fill, outline) {
  const half = side / 2;
  const dx = tx - cx, dy = ty - cy;
  const dist = Math.hypot(dx, dy);
  if (dist >= 1) {
    const halfW = (box[2] - box[0]) / 2, halfH = (box[3] - box[1]) / 2;
    const t0 = Math.min(dx ? halfW / Math.abs(dx) : Infinity, dy ? halfH / Math.abs(dy) : Infinity, 1);
    const sx = cx + dx * t0, sy = cy + dy * t0;
    const t1 = Math.min(dx ? half / Math.abs(dx) : Infinity, dy ? half / Math.abs(dy) : Infinity, 1);
    const ex = tx - dx * t1, ey = ty - dy * t1;
    if (Math.hypot(ex - sx, ey - sy) > lineW) {
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
      ctx.lineWidth = lineW + 2 * edge; ctx.strokeStyle = outline; ctx.stroke();
      ctx.lineWidth = lineW; ctx.strokeStyle = fill; ctx.stroke();
    }
  }
  ctx.fillStyle = fill;
  ctx.fillRect(tx - half, ty - half, side, side);
  ctx.lineWidth = edge; ctx.strokeStyle = outline;
  ctx.strokeRect(tx - half, ty - half, side, side);
}

/** Draw labels (coordinates in full-image pixels) onto ctx at the given scale
 *  and offset. Returns each label's text box in ctx pixels, for hit-testing. */
export function drawLabels(ctx, labels, fullWidth, style, scale, ox = 0, oy = 0) {
  const { fontPx, pad, lineW } = metrics(fullWidth, style, scale);
  const edge = Math.max(1, lineW * 0.4);
  ctx.font = `bold ${fontPx}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const boxes = [];
  for (const lb of labels) {
    const cx = lb.x * scale + ox, cy = lb.y * scale + oy;
    const m = ctx.measureText(lb.text);
    const asc = m.actualBoundingBoxAscent || fontPx * 0.4;
    const desc = m.actualBoundingBoxDescent || fontPx * 0.4;
    const box = [cx - m.width / 2 - pad, cy - asc - pad * 0.6, cx + m.width / 2 + pad, cy + desc + pad * 0.6];
    boxes.push(box);
    const outline = outlineFor(lb.fill);
    if (lb.tip) {
      const side = Math.max(4, (fullWidth * lb.marker) / 100 * scale);
      drawLeader(ctx, box, cx, cy, lb.tip[0] * scale + ox, lb.tip[1] * scale + oy, side, lineW, edge, lb.fill, outline);
    }
    roundRect(ctx, box, pad * 0.5);
    ctx.fillStyle = lb.fill; ctx.fill();
    ctx.lineWidth = edge; ctx.strokeStyle = outline; ctx.stroke();
    ctx.fillStyle = outline;
    ctx.fillText(lb.text, cx, cy);
  }
  return boxes;
}

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const HELP = [
  ['Click a part', 'square there, text box beside it'],
  ['Drag from a part', 'choose where the text goes'],
  ['Drag text / square', 'move it'],
  ['Click a label', 'select it'],
  ['Double-click a label', 'edit its text'],
  ['Enter / Esc', 'place / cancel the text you are typing'],
  ['S', 'save this photo (downloads name_labeled) and go to the next'],
  ['N / P', 'next / previous photo'],
  ['Z / Y', 'undo / redo'],
  ['Delete', 'delete the selected label'],
  ['+ / -', 'text size'],
  ['[ / ]', 'square size'],
  ['C / K', 'cycle colours / colour picker'],
  ['Shift-click', 'text only, no square'],
];

export class Labeler {
  constructor(container) {
    this.container = container;
    this.images = [];          // {name, type, key, bitmap, width, height, labels, undo, redo, dirty}
    this.index = -1;
    this.style = Object.assign({ fontPct: 3, markerPct: 2.5, fill: COLOURS[0] }, loadJSON(STYLE_KEY, {}));
    this.saved = loadJSON(LABELS_KEY, {});
    this.selected = null;
    this.textOnly = false;
    this.press = null; this.mode = null; this.moved = false; this.grab = [0, 0];
    this.rubber = null;
    this.entry = null;
    this.scale = 1; this.offset = [0, 0]; this.boxes = [];
    this.buildDom();
    this.bind();
    this.refresh();
  }

  // ---- DOM ------------------------------------------------------------- //
  buildDom() {
    const c = this.container;
    c.classList.add('bbl');
    c.innerHTML = `
      <div class="bbl-toolbar">
        <label class="bbl-btn bbl-primary">Open photos<input type="file" accept="image/*" multiple hidden></label>
        <button data-act="prev" title="Previous (P)">&#9664;</button>
        <span class="bbl-count"></span>
        <button data-act="next" title="Next (N)">&#9654;</button>
        <button data-act="save" class="bbl-primary" title="Save this photo and go to the next (S)">Save</button>
        <button data-act="saveAll" title="Download every photo that has labels">Save all</button>
        <span class="bbl-sep"></span>
        <button data-act="undo" title="Undo (Z)">&#8630;</button>
        <button data-act="redo" title="Redo (Y)">&#8631;</button>
        <button data-act="edit" title="Edit selected text (double-click)">Edit</button>
        <button data-act="delete" title="Delete selected (Del)">Delete</button>
        <span class="bbl-sep"></span>
        <span class="bbl-group" title="Text size (+ / -)">T <button data-act="fontDown">&minus;</button><button data-act="fontUp">+</button></span>
        <span class="bbl-group" title="Square size ([ / ])">&#9632; <button data-act="markerDown">&minus;</button><button data-act="markerUp">+</button></span>
        <span class="bbl-swatches"></span>
        <input type="color" class="bbl-colour" title="Any colour (K)">
        <button data-act="textOnly" class="bbl-toggle" title="Next label: text only, no square (or shift-click)">Text only</button>
        <button data-act="help" title="Keys">?</button>
      </div>
      <div class="bbl-status">Open some photos to start.</div>
      <div class="bbl-stage">
        <canvas class="bbl-canvas"></canvas>
        <input class="bbl-entry" hidden spellcheck="false">
        <div class="bbl-drop">Drop photos here, or use Open photos</div>
        <div class="bbl-help" hidden>${HELP.map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('')}</div>
      </div>`;
    this.fileInput = c.querySelector('input[type=file]');
    this.canvas = c.querySelector('.bbl-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.entryEl = c.querySelector('.bbl-entry');
    this.statusEl = c.querySelector('.bbl-status');
    this.countEl = c.querySelector('.bbl-count');
    this.stage = c.querySelector('.bbl-stage');
    this.dropEl = c.querySelector('.bbl-drop');
    this.helpEl = c.querySelector('.bbl-help');
    this.colourInput = c.querySelector('.bbl-colour');
    this.textOnlyBtn = c.querySelector('[data-act=textOnly]');
    const sw = c.querySelector('.bbl-swatches');
    for (const col of COLOURS) {
      const b = document.createElement('button');
      b.className = 'bbl-swatch'; b.style.background = col; b.dataset.colour = col; b.title = col;
      sw.appendChild(b);
    }
  }

  bind() {
    const c = this.container;
    this.fileInput.addEventListener('change', () => { this.openFiles(this.fileInput.files); this.fileInput.value = ''; });
    c.querySelector('.bbl-toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.colour) { this.applyColour(b.dataset.colour); return; }
      const act = b.dataset.act; if (act) this.action(act);
    });
    this.colourInput.addEventListener('input', () => this.applyColour(this.colourInput.value.toUpperCase()));
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => this.onPress(e));
    cv.addEventListener('pointermove', (e) => this.onDrag(e));
    cv.addEventListener('pointerup', (e) => this.onRelease(e));
    cv.addEventListener('pointercancel', () => { this.press = null; this.mode = null; this.rubber = null; this.refresh(); });
    cv.addEventListener('dblclick', (e) => this.onDouble(e));
    this.entryEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.commitEntry(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.cancelEntry(); }
      e.stopPropagation();
    });
    this.entryEl.addEventListener('input', () => this.growEntry());
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.stage.addEventListener('dragover', (e) => { e.preventDefault(); this.stage.classList.add('bbl-over'); });
    this.stage.addEventListener('dragleave', () => this.stage.classList.remove('bbl-over'));
    this.stage.addEventListener('drop', (e) => { e.preventDefault(); this.stage.classList.remove('bbl-over'); this.openFiles(e.dataTransfer.files); });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.refresh()).observe(this.stage);
    else window.addEventListener('resize', () => this.refresh());
    window.addEventListener('beforeunload', (e) => { if (this.images.some((im) => im.dirty)) { e.preventDefault(); e.returnValue = ''; } });
  }

  action(act) {
    const map = {
      prev: () => this.step(-1), next: () => this.step(1), save: () => this.saveAndNext(), saveAll: () => this.saveAll(),
      undo: () => this.undo(), redo: () => this.redo(), delete: () => this.deleteSelected(), edit: () => this.editSelected(),
      fontUp: () => this.adjustFont(0.25), fontDown: () => this.adjustFont(-0.25),
      markerUp: () => this.adjustMarker(0.25), markerDown: () => this.adjustMarker(-0.25),
      textOnly: () => { this.textOnly = !this.textOnly; this.textOnlyBtn.classList.toggle('bbl-on', this.textOnly); },
      help: () => { this.helpEl.hidden = !this.helpEl.hidden; },
    };
    if (map[act]) map[act]();
  }

  // ---- images ---------------------------------------------------------- //
  get current() { return this.images[this.index] || null; }

  async openFiles(files) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith('image/') && !/_labeled\.[^.]+$/i.test(f.name));
    if (!list.length) return;
    const firstNew = this.images.length;
    for (const f of list) {
      const key = `${f.name}|${f.size}|${f.lastModified}`;
      if (this.images.some((im) => im.key === key)) continue;
      const bitmap = await this.decode(f);
      const stored = this.saved[key];
      this.images.push({
        name: f.name, type: f.type, key, bitmap, width: bitmap.width, height: bitmap.height,
        labels: stored ? stored.map((l) => ({ ...l })) : [], undo: [], redo: [], dirty: false,
      });
    }
    if (this.index < 0 && this.images.length) this.load(0);
    else if (this.images.length > firstNew) this.flash(`Added ${this.images.length - firstNew} photo(s); ${this.images.length} in the queue.`);
    this.refresh();
  }

  async decode(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = reject;
        img.src = url;
      });
    }
  }

  load(i) {
    this.cancelEntry();
    this.index = i;
    this.selected = null;
    this.refresh();
  }

  step(d) {
    const n = this.index + d;
    if (n >= 0 && n < this.images.length) this.load(n);
    else this.flash(d > 0 ? 'No more photos that way.' : 'This is the first photo.');
  }

  outputName(im) {
    const dot = im.name.lastIndexOf('.');
    const stem = dot > 0 ? im.name.slice(0, dot) : im.name;
    const jpeg = im.type === 'image/jpeg';
    return { name: `${stem}_labeled.${jpeg ? 'jpg' : 'png'}`, mime: jpeg ? 'image/jpeg' : 'image/png' };
  }

  /** Full-resolution render of one image. */
  renderFull(im = this.current) {
    const cv = document.createElement('canvas');
    cv.width = im.width; cv.height = im.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(im.bitmap, 0, 0);
    drawLabels(ctx, im.labels, im.width, this.style, 1);
    return cv;
  }

  async saveBlob(im = this.current) {
    const { mime } = this.outputName(im);
    const cv = this.renderFull(im);
    return new Promise((resolve) => cv.toBlob(resolve, mime, 0.95));
  }

  async download(im = this.current) {
    if (!im) return;
    const blob = await this.saveBlob(im);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.outputName(im).name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    im.dirty = false;
    this.persist();
  }

  async saveAndNext() {
    if (!this.current) return;
    this.commitEntry();
    await this.download();
    if (this.index + 1 < this.images.length) this.load(this.index + 1);
    else { this.flash('All photos saved.'); this.refresh(); }
  }

  async saveAll() {
    this.commitEntry();
    for (const im of this.images) if (im.labels.length) await this.download(im);
    this.refresh();
  }

  persist() {
    for (const im of this.images) this.saved[im.key] = im.labels;
    saveJSON(LABELS_KEY, this.saved);
  }

  // ---- undo / redo ----------------------------------------------------- //
  snapshot() {
    const im = this.current; if (!im) return;
    im.undo.push(im.labels.map((l) => ({ ...l, tip: l.tip ? [...l.tip] : null })));
    if (im.undo.length > 100) im.undo.shift();
    im.redo.length = 0;
  }
  changed() { const im = this.current; if (im) { im.dirty = true; this.persist(); } this.refresh(); }
  undo() {
    const im = this.current; if (!im || !im.undo.length) { this.flash('Nothing to undo.'); return; }
    im.redo.push(im.labels); im.labels = im.undo.pop(); this.selected = null; this.changed();
  }
  redo() {
    const im = this.current; if (!im || !im.redo.length) { this.flash('Nothing to redo.'); return; }
    im.undo.push(im.labels); im.labels = im.redo.pop(); this.selected = null; this.changed();
  }

  // ---- geometry -------------------------------------------------------- //
  layout() {
    const im = this.current;
    const rect = this.stage.getBoundingClientRect();
    const cw = Math.max(1, rect.width), ch = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr); this.canvas.height = Math.round(ch * dpr);
    }
    this.canvas.style.width = `${cw}px`; this.canvas.style.height = `${ch}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!im) return;
    this.scale = Math.min(cw / im.width, ch / im.height);
    const dw = im.width * this.scale, dh = im.height * this.scale;
    this.offset = [(cw - dw) / 2, (ch - dh) / 2];
  }
  toImage(x, y) {
    const im = this.current;
    const ix = Math.min(Math.max((x - this.offset[0]) / this.scale, 0), im.width - 1);
    const iy = Math.min(Math.max((y - this.offset[1]) / this.scale, 0), im.height - 1);
    return [ix, iy];
  }
  toDisplay(ix, iy) { return [ix * this.scale + this.offset[0], iy * this.scale + this.offset[1]]; }
  pos(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  markerDisp(lb) { return Math.max(4, (this.current.width * lb.marker) / 100 * this.scale); }
  hitTip(x, y) {
    const { lineW } = metrics(this.current.width, this.style, this.scale);
    const ls = this.current.labels;
    for (let i = ls.length - 1; i >= 0; i--) {
      if (!ls[i].tip) continue;
      const [tx, ty] = this.toDisplay(...ls[i].tip);
      const reach = Math.max(14, this.markerDisp(ls[i]) / 2 + lineW);
      if (Math.abs(x - tx) <= reach && Math.abs(y - ty) <= reach) return i;
    }
    return null;
  }
  hitLabel(x, y) {
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const [x0, y0, x1, y1] = this.boxes[i];
      if (x >= x0 - 6 && x <= x1 + 6 && y >= y0 - 6 && y <= y1 + 6) return i;
    }
    return null;
  }
  defaultTextPos(tip) {
    const { width: w, height: h } = this.current;
    const dx = tip[0] > 0.72 * w ? -0.09 * w : 0.09 * w;
    const dy = tip[1] < 0.12 * h ? 0.06 * w : -0.06 * w;
    return [Math.min(Math.max(tip[0] + dx, 0), w - 1), Math.min(Math.max(tip[1] + dy, 0), h - 1)];
  }

  // ---- drawing --------------------------------------------------------- //
  refresh() {
    this.layout();
    const im = this.current;
    const ctx = this.ctx;
    const cw = parseFloat(this.canvas.style.width), ch = parseFloat(this.canvas.style.height);
    ctx.clearRect(0, 0, cw, ch);
    this.dropEl.hidden = !!im;
    if (!im) { this.boxes = []; this.status(); return; }
    ctx.drawImage(im.bitmap, this.offset[0], this.offset[1], im.width * this.scale, im.height * this.scale);
    this.boxes = drawLabels(ctx, im.labels, im.width, this.style, this.scale, this.offset[0], this.offset[1]);
    if (this.selected !== null && this.boxes[this.selected]) {
      const [x0, y0, x1, y1] = this.boxes[this.selected];
      ctx.save(); ctx.setLineDash([5, 3]); ctx.lineWidth = 2; ctx.strokeStyle = '#00E5FF';
      ctx.strokeRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8); ctx.restore();
    }
    if (this.rubber) this.drawPreview(this.rubber.text, this.rubber.tip, this.style.fill, this.style.markerPct);
    if (this.entry) this.drawPreview(this.entry.disp, this.entry.tipDisp, this.entry.fill, this.style.markerPct);
    this.status();
  }
  drawPreview(text, tip, fill, markerPct) {
    if (!tip) return;
    const ctx = this.ctx;
    const half = Math.max(4, (this.current.width * markerPct) / 100 * this.scale) / 2;
    ctx.save();
    ctx.lineWidth = 3; ctx.strokeStyle = fill; ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(...text); ctx.lineTo(...tip); ctx.stroke();
    ctx.fillRect(tip[0] - half, tip[1] - half, half * 2, half * 2);
    ctx.restore();
  }
  status(extra) {
    const im = this.current;
    const s = this.style;
    this.countEl.textContent = im ? `${this.index + 1}/${this.images.length}` : '0/0';
    if (!im) { this.statusEl.textContent = extra || 'Open some photos to start. Photos stay on your device.'; return; }
    const sel = this.selected !== null && im.labels[this.selected] ? `  ·  selected: "${im.labels[this.selected].text}"` : '';
    const base = `${im.name}${im.dirty ? ' *' : ''}  ·  labels: ${im.labels.length}${sel}  ·  text ${s.fontPct}%  square ${s.markerPct}%  colour ${s.fill}`;
    this.statusEl.textContent = extra ? `${extra}   |   ${base}` : base;
    this.colourInput.value = s.fill;
  }
  flash(text) {
    this.status(text);
    clearTimeout(this._flash);
    this._flash = setTimeout(() => this.status(), 2500);
  }

  // ---- pointer --------------------------------------------------------- //
  onPress(e) {
    if (!this.current || e.button !== 0) return;
    if (this.entry) this.commitEntry();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    const [x, y] = this.pos(e);
    this.press = [x, y]; this.moved = false; this.shift = e.shiftKey;
    let i = this.hitTip(x, y);
    if (i !== null) { this.mode = 'tip'; this.selected = i; }
    else if ((i = this.hitLabel(x, y)) !== null) {
      this.mode = 'move'; this.selected = i;
      const [lx, ly] = this.toDisplay(this.current.labels[i].x, this.current.labels[i].y);
      this.grab = [x - lx, y - ly];
    } else { this.mode = 'new'; this.selected = null; }
    if (this.mode !== 'new') this.snapshot();
    this.refresh();
  }
  onDrag(e) {
    if (!this.press || !this.mode) return;
    const [x, y] = this.pos(e);
    if (!this.moved && Math.hypot(x - this.press[0], y - this.press[1]) < DRAG_THRESHOLD) return;
    this.moved = true;
    const lb = this.selected !== null ? this.current.labels[this.selected] : null;
    if (this.mode === 'new') this.rubber = { text: [x, y], tip: this.press };
    else if (this.mode === 'move' && lb) { [lb.x, lb.y] = this.toImage(x - this.grab[0], y - this.grab[1]); this.current.dirty = true; }
    else if (this.mode === 'tip' && lb) { lb.tip = this.toImage(x, y); this.current.dirty = true; }
    this.refresh();
  }
  onRelease(e) {
    if (!this.press) return;
    const [px, py] = this.press;
    const { mode, moved } = this;
    this.press = null; this.mode = null; this.moved = false; this.rubber = null;
    const [x, y] = this.pos(e);
    if (mode !== 'new') {
      if (!moved) this.current.undo.pop();       // plain click on a label: nothing changed
      else this.persist();
      this.refresh();
      return;
    }
    if (this.entry) return;                       // a double-click already opened the editor
    let pos, tip;
    if (moved) { pos = this.toImage(x, y); tip = this.toImage(px, py); }
    else if (this.shift || this.textOnly) { pos = this.toImage(px, py); tip = null; }
    else { tip = this.toImage(px, py); pos = this.defaultTextPos(tip); }
    this.openEntry(pos, tip, null);
  }
  onDouble(e) {
    const [x, y] = this.pos(e);
    const i = this.hitLabel(x, y);
    if (i === null) return;
    this.cancelEntry();
    this.press = null; this.mode = null;
    this.selected = i;
    const lb = this.current.labels[i];
    this.openEntry([lb.x, lb.y], lb.tip, i);
  }
  editSelected() {
    if (this.selected === null || !this.current) return;
    const lb = this.current.labels[this.selected];
    this.openEntry([lb.x, lb.y], lb.tip, this.selected);
  }

  // ---- text entry ------------------------------------------------------ //
  openEntry(pos, tip, editing) {
    const im = this.current;
    const fill = editing !== null ? im.labels[editing].fill : this.style.fill;
    const disp = this.toDisplay(...pos);
    const { fontPx } = metrics(im.width, this.style, this.scale);
    this.entry = { pos, tip, editing, fill, disp, tipDisp: tip && editing === null ? this.toDisplay(...tip) : null };
    const el = this.entryEl;
    el.hidden = false;
    el.value = editing !== null ? im.labels[editing].text : '';
    el.style.left = `${disp[0]}px`; el.style.top = `${disp[1]}px`;
    el.style.fontSize = `${Math.max(12, fontPx * 0.9)}px`;
    el.style.background = fill; el.style.color = outlineFor(fill);
    this.growEntry();
    el.focus(); el.select();
    this.refresh();
    this.status('Type the label, Enter to place it, Esc to cancel');
  }
  growEntry() { this.entryEl.style.width = `${Math.max(6, this.entryEl.value.length + 2)}ch`; }
  commitEntry() {
    if (!this.entry) return;
    const { pos, tip, editing } = this.entry;
    const text = this.entryEl.value.trim();
    this.cancelEntry();
    const im = this.current;
    if (editing !== null) {
      if (text !== im.labels[editing].text) this.snapshot();
      if (text) im.labels[editing].text = text;
      else { im.labels.splice(editing, 1); this.selected = null; }
      this.changed();
    } else if (text) {
      this.snapshot();
      im.labels.push({ x: pos[0], y: pos[1], text, tip, fill: this.style.fill, marker: this.style.markerPct });
      this.changed();
    }
  }
  cancelEntry() {
    if (!this.entry) return;
    this.entry = null;
    this.entryEl.hidden = true; this.entryEl.value = '';
    this.refresh();
  }

  // ---- edits ----------------------------------------------------------- //
  applyColour(fill) {
    if (this.selected !== null && this.current) { this.snapshot(); this.current.labels[this.selected].fill = fill; this.changed(); }
    else { this.style.fill = fill; saveJSON(STYLE_KEY, this.style); this.refresh(); }
  }
  cycleColour() {
    const cur = this.selected !== null && this.current ? this.current.labels[this.selected].fill : this.style.fill;
    const i = COLOURS.indexOf(cur);
    this.applyColour(COLOURS[(i + 1) % COLOURS.length]);
  }
  adjustFont(d) {
    this.style.fontPct = Math.min(15, Math.max(0.5, Math.round((this.style.fontPct + d) * 100) / 100));
    saveJSON(STYLE_KEY, this.style); this.refresh();
  }
  adjustMarker(d) {
    if (this.selected !== null && this.current) {
      this.snapshot();
      const lb = this.current.labels[this.selected];
      lb.marker = Math.min(20, Math.max(0.5, Math.round((lb.marker + d) * 100) / 100));
      this.changed();
    } else {
      this.style.markerPct = Math.min(20, Math.max(0.5, Math.round((this.style.markerPct + d) * 100) / 100));
      saveJSON(STYLE_KEY, this.style); this.refresh();
    }
  }
  deleteSelected() {
    if (this.selected === null || !this.current) return;
    this.snapshot();
    this.current.labels.splice(this.selected, 1);
    this.selected = null;
    this.changed();
  }

  // ---- keys ------------------------------------------------------------ //
  onKey(e) {
    if (this.entry || e.target === this.entryEl) return;
    if (e.target && e.target.matches && e.target.matches('input, textarea, select')) return;
    if (e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const acts = {
      s: () => this.saveAndNext(), n: () => this.step(1), arrowright: () => this.step(1),
      p: () => this.step(-1), arrowleft: () => this.step(-1),
      z: () => (e.ctrlKey && e.shiftKey ? this.redo() : this.undo()), y: () => this.redo(),
      delete: () => this.deleteSelected(), backspace: () => this.deleteSelected(),
      escape: () => { if (this.selected !== null) { this.selected = null; this.refresh(); } else this.helpEl.hidden = true; },
      '+': () => this.adjustFont(0.25), '=': () => this.adjustFont(0.25), '-': () => this.adjustFont(-0.25), '_': () => this.adjustFont(-0.25),
      '[': () => this.adjustMarker(-0.25), ']': () => this.adjustMarker(0.25),
      c: () => this.cycleColour(), k: () => this.colourInput.click(),
      o: () => this.fileInput.click(), '?': () => this.action('help'),
    };
    if (e.ctrlKey && !['z', 'y'].includes(k)) return;
    if (acts[k]) { e.preventDefault(); acts[k](); }
  }
}
