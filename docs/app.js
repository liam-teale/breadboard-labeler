// Breadboard labeler - browser version.
// A label is: text on a solid coloured box, a solid square on the part it
// refers to, and a line joining them. Everything runs in the browser; photos
// never leave the device, and the original files are never modified: saving
// always downloads a new *_labeled copy.

// Presets follow the Analog Discovery (WaveForms) channel colours the group uses:
// yellow, orange, blue, pink, green, brown, then red, white, light grey, black.
export const COLOURS = ['#FFEB3B', '#FF9800', '#2962FF', '#FF66CC', '#76FF03', '#8D5524',
  '#FF3B30', '#FFFFFF', '#D3D3D3', '#000000'];
const STYLE_KEY = 'bbl.style';
const PRESETS_KEY = 'bbl.customColours';
// HEIC/HEIF (iPhone photos) are decoded with heic-to (libheif 1.22, handles the
// 10-bit HDR files newer iPhones produce), fetched only the first time such a
// file is opened. The "csp" build avoids eval so it also runs under a strict CSP.
const HEIC_DECODER_URL = 'https://cdn.jsdelivr.net/npm/heic-to@1.5.2/dist/csp/heic-to.min.js';
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|bmp|avif|tiff?|heic|heif)$/i;
const HEIC_NAME = /\.hei[cf]$/i;
const OUTPUT_NAME = /_labeled(_\d+)?\.[^.]+$/i;

// File System Access API (Chrome, Edge): durable file/folder handles that survive a
// reload, and permission to write labelled copies next to the originals.
export const FS_ACCESS = typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
const PICKER_TYPES = [{ description: 'Photos', accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.heif'] } }];

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('bbl', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => { const t = db.transaction('kv').objectStore('kv').get(key); t.onsuccess = () => resolve(t.result); t.onerror = () => reject(t.error); });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').put(value, key); t.onsuccess = () => resolve(); t.onerror = () => reject(t.error); });
}

export function isHeic(file) {
  return /^image\/hei[cf]$/i.test(file.type) || HEIC_NAME.test(file.name);
}
export function isImageFile(file) {
  return (file.type.startsWith('image/') || IMAGE_NAME.test(file.name)) && !OUTPUT_NAME.test(file.name);
}
const LABELS_KEY = 'bbl.labels';
const DRAG_THRESHOLD = 6;
// 0.85 is visually identical to 0.95 on a photo at half the file size.
const JPEG_QUALITY = 0.85;

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
  ['S', 'save this photo (a new name_labeled copy, into its folder or Downloads) and go to the next'],
  ['O / F', 'open more photos / a whole folder'],
  ['N / P', 'next / previous photo'],
  ['Z / Y', 'undo / redo'],
  ['Delete', 'delete the selected label'],
  ['+ / -', 'text size'],
  ['[ / ]', 'square size'],
  ['C / K', 'cycle colours / colour picker'],
  ['+ button', 'save the current colour as a preset (right-click a custom one to remove)'],
  ['Shift-click', 'text only, no square'],
];

export class Labeler {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.images = [];          // {name, type, key, bitmap, width, height, labels, undo, redo, dirty}
    this.index = -1;
    this.style = Object.assign({ fontPct: 3, markerPct: 2.5, fill: COLOURS[0], format: 'jpg', saveTo: 'folder' }, loadJSON(STYLE_KEY, {}));
    if (!['jpg', 'png'].includes(this.style.format)) this.style.format = 'jpg';
    if (!['folder', 'download'].includes(this.style.saveTo)) this.style.saveTo = 'folder';
    this.saved = loadJSON(LABELS_KEY, {});
    this.custom = (loadJSON(PRESETS_KEY, []) || []).filter((c) => /^#[0-9A-F]{6}$/i.test(c)).map((c) => c.toUpperCase());
    this.selected = null;
    this.textOnly = false;
    this.press = null; this.mode = null; this.moved = false; this.grab = [0, 0];
    this.rubber = null;
    this.base = null;            // screen-sized copy of the current photo, redrawn from on every refresh
    this._raf = 0;
    this._loadToken = 0;
    this.entry = null;
    this.scale = 1; this.offset = [0, 0]; this.boxes = [];
    this.buildDom();
    this.bind();
    this.refresh();
    if (opts.resume !== false) this.checkSession();
  }

  // ---- DOM ------------------------------------------------------------- //
  buildDom() {
    const c = this.container;
    c.classList.add('bbl');
    c.innerHTML = `
      <div class="bbl-toolbar">
        <label class="bbl-btn bbl-primary bbl-open-photos">Open photos<input type="file" accept="image/*,.heic,.heif" multiple hidden></label>
        <label class="bbl-btn bbl-folder">Open folder<input type="file" class="bbl-folder-input" webkitdirectory multiple hidden></label>
        <button data-act="prev" title="Previous (P)">&#9664;</button>
        <span class="bbl-count"></span>
        <button data-act="next" title="Next (N)">&#9654;</button>
        <button data-act="save" class="bbl-primary" title="Save this photo and go to the next (S)">Save</button>
        <button data-act="saveAll" title="Download every photo that has labels">Save all</button>
        <select class="bbl-format" title="Output format for every save, whatever the input was">
          <option value="jpg">as JPG</option><option value="png">as PNG</option>
        </select>
        <select class="bbl-saveto" hidden title="Where saves go. Photos opened with Open folder can be saved next to the originals.">
          <option value="folder">into folder</option><option value="download">to Downloads</option>
        </select>
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
        <button data-act="addPreset" class="bbl-add" title="Save the current colour as a preset (right-click a custom preset to remove it)">+</button>
        <button data-act="textOnly" class="bbl-toggle" title="Next label: text only, no square (or shift-click)">Text only</button>
        <button data-act="help" title="Keys">?</button>
      </div>
      <div class="bbl-status">Open some photos to start.</div>
      <div class="bbl-stage">
        <canvas class="bbl-canvas"></canvas>
        <input class="bbl-entry" hidden spellcheck="false">
        <div class="bbl-drop"><div>Drop photos here, or use Open photos</div><button class="bbl-resume" hidden>Reopen last session</button></div>
        <div class="bbl-help" hidden>${HELP.map(([k, v]) => `<div><b>${k}</b><span>${v}</span></div>`).join('')}</div>
      </div>`;
    this.fileInput = c.querySelector('input[type=file]');
    this.folderInput = c.querySelector('.bbl-folder-input');
    if (!FS_ACCESS && !('webkitdirectory' in this.folderInput)) c.querySelector('.bbl-folder').hidden = true;   // e.g. iOS Safari
    this.resumeBtn = c.querySelector('.bbl-resume');
    this.saveToSelect = c.querySelector('.bbl-saveto');
    this.saveToSelect.hidden = !FS_ACCESS;
    this.saveToSelect.value = this.style.saveTo;
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
    this.formatSelect = c.querySelector('.bbl-format');
    this.formatSelect.value = this.style.format;
    this.swatchesEl = c.querySelector('.bbl-swatches');
    this.renderSwatches();
  }

  /** Built-in presets followed by the user's own. */
  presets() { return [...COLOURS, ...this.custom]; }

  renderSwatches() {
    this.swatchesEl.innerHTML = '';
    for (const col of this.presets()) {
      const b = document.createElement('button');
      const own = !COLOURS.includes(col);
      b.className = 'bbl-swatch' + (own ? ' bbl-swatch-custom' : '');
      b.style.background = col; b.dataset.colour = col;
      b.title = own ? `${col} (your preset; right-click to remove)` : col;
      this.swatchesEl.appendChild(b);
    }
  }

  addPreset(col) {
    col = (col || this.currentColour()).toUpperCase();
    if (this.presets().includes(col)) { this.flash(`${col} is already a preset.`); return false; }
    this.custom.push(col);
    saveJSON(PRESETS_KEY, this.custom);
    this.renderSwatches();
    this.flash(`Saved ${col} as a preset.`);
    return true;
  }

  removePreset(col) {
    const i = this.custom.indexOf(col.toUpperCase());
    if (i < 0) return false;
    this.custom.splice(i, 1);
    saveJSON(PRESETS_KEY, this.custom);
    this.renderSwatches();
    this.flash(`Removed preset ${col.toUpperCase()}.`);
    return true;
  }

  /** The colour that C/K/swatches would change: the selected label's, the label being typed, or the default. */
  currentColour() {
    if (this.selected !== null && this.current) return this.current.labels[this.selected].fill;
    if (this.entry) return this.entry.fill;
    return this.style.fill;
  }

  bind() {
    const c = this.container;
    this.fileInput.addEventListener('change', () => { this.openFiles(this.fileInput.files); this.fileInput.value = ''; });
    this.folderInput.addEventListener('change', () => { this.openFiles(this.folderInput.files); this.folderInput.value = ''; });
    // with the File System Access API the labels open native pickers instead of the hidden inputs
    c.querySelector('.bbl-open-photos').addEventListener('click', (e) => { if (FS_ACCESS) { e.preventDefault(); this.openPhotos(); } });
    c.querySelector('.bbl-folder').addEventListener('click', (e) => { if (FS_ACCESS) { e.preventDefault(); this.openFolder(); } });
    this.resumeBtn.addEventListener('click', async () => {
      this.resumeBtn.disabled = true;
      const ok = await this.restoreSession({ interactive: true });
      this.resumeBtn.disabled = false;
      if (!ok) this.flash('Could not reopen the last session; use Open photos or Open folder.');
    });
    this.saveToSelect.addEventListener('change', () => this.setSaveTo(this.saveToSelect.value));
    c.querySelector('.bbl-toolbar').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.colour) { this.applyColour(b.dataset.colour); return; }
      const act = b.dataset.act; if (act) this.action(act);
    });
    this.swatchesEl.addEventListener('contextmenu', (e) => {
      const b = e.target.closest('.bbl-swatch-custom'); if (!b) return;
      e.preventDefault(); this.removePreset(b.dataset.colour);
    });
    this.colourInput.addEventListener('input', () => this.applyColour(this.colourInput.value.toUpperCase()));
    this.formatSelect.addEventListener('change', () => this.setFormat(this.formatSelect.value));
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
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.requestRefresh()).observe(this.stage);
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
      addPreset: () => this.addPreset(),
    };
    if (map[act]) map[act]();
  }

  // ---- images ---------------------------------------------------------- //
  get current() { return this.images[this.index] || null; }

  async openFiles(files) {
    // A folder pick includes everything inside it; keep only images and skip earlier outputs.
    const list = Array.from(files || [])
      .filter(isImageFile)
      .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }));
    if (!list.length) { this.flash('No photos found there.'); return; }
    await this.addEntries(list.map((file) => ({ file })));
  }

  /** entries: {file, handle?, dir?, path?}. handle/dir/path come from the File System Access API. */
  async addEntries(entries) {
    const firstNew = this.images.length;
    for (const e of entries) {
      const f = e.file;
      const key = `${f.name}|${f.size}|${f.lastModified}`;
      if (this.images.some((im) => im.key === key)) continue;
      const stored = this.saved[key];
      // Photos are decoded on demand (see ensure/trim): a 12 MP photo is ~48 MB decoded,
      // so only the current one and its neighbours are kept in memory.
      this.images.push({
        name: f.name, type: f.type, key, file: f, handle: e.handle || null, dir: e.dir || null, path: e.path || null,
        bitmap: null, decoding: null, broken: false, width: 0, height: 0,
        labels: stored ? stored.map((l) => ({ ...l })) : [], undo: [], redo: [], dirty: false,
      });
    }
    if (this.index < 0 && this.images.length) await this.load(0);
    else this.refresh();                 // redraw first: flash() must be the last thing to touch the status line
    const added = this.images.length - firstNew;
    if (added && firstNew > 0) this.flash(`Added ${added} photo(s); ${this.images.length} in the queue.`);
    this.saveSession();
  }

  // ---- File System Access: pickers, folders, sessions, saving in place --- //
  async openPhotos() {
    if (!FS_ACCESS) { this.fileInput.click(); return; }
    let handles;
    try { handles = await window.showOpenFilePicker({ multiple: true, types: PICKER_TYPES }); } catch { return; }   // cancelled
    const entries = [];
    for (const h of handles) {
      const file = await h.getFile();
      if (isImageFile(file)) entries.push({ file, handle: h });
    }
    if (!entries.length) { this.flash('No photos found there.'); return; }
    await this.addEntries(entries);
  }

  async openFolder() {
    if (!FS_ACCESS) { this.folderInput.click(); return; }
    let dir;
    try { dir = await window.showDirectoryPicker({ mode: 'read' }); } catch { return; }   // cancelled
    await this.openDirectoryHandle(dir);
  }

  /** Queue every original photo inside a folder handle (subfolders included). */
  async openDirectoryHandle(dir) {
    const entries = await this.listDirectory(dir, dir, []);
    if (!entries.length) { this.flash('No photos found there.'); return; }
    // top-level photos first, then subfolders; natural number order within each
    entries.sort((a, b) => (a.path.length - b.path.length) || a.path.join('/').localeCompare(b.path.join('/'), undefined, { numeric: true }));
    await this.addEntries(entries);
  }

  async listDirectory(root, dir, path, depth = 0) {
    const out = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') {
        if (depth < 3 && !name.startsWith('.')) out.push(...await this.listDirectory(root, h, [...path, name], depth + 1));
        continue;
      }
      if (!IMAGE_NAME.test(name) || OUTPUT_NAME.test(name)) continue;
      out.push({ file: await h.getFile(), handle: h, dir: root, path: [...path, name] });
    }
    return out;
  }

  /** Remember the open handles and position so a reload (or a discarded tab) can pick up where you left off. */
  async saveSession() {
    if (!FS_ACCESS) return;
    const dirs = [], items = [];
    for (const im of this.images) {
      if (im.dir) {
        let di = dirs.indexOf(im.dir);
        if (di < 0) { di = dirs.length; dirs.push(im.dir); }
        items.push({ dir: di, path: im.path });
      } else if (im.handle) items.push({ handle: im.handle });
    }
    if (!items.length) return;           // opened through the fallback picker: nothing restorable
    try { await idbSet('session', { dirs, items, index: Math.max(0, this.index), savedAt: Date.now() }); }
    catch (err) { console.warn('session not saved', err); }
  }

  async clearSession() { try { await idbSet('session', null); } catch { /* ignore */ } }

  /** On startup: reopen silently if permission is still granted, otherwise offer a button. */
  async checkSession() {
    if (!FS_ACCESS) return;
    let session = null;
    try { session = await idbGet('session'); } catch { return; }
    if (!session || !session.items.length) return;
    if (await this.restoreSession({ interactive: false, session })) return;
    this.resumeBtn.textContent = `Reopen last session (${session.items.length} photo${session.items.length === 1 ? '' : 's'})`;
    this.resumeBtn.hidden = false;
  }

  async restoreSession({ interactive, session = null } = {}) {
    if (!FS_ACCESS) return false;
    let s = session;
    if (!s) { try { s = await idbGet('session'); } catch { return false; } }
    if (!s || !s.items.length) return false;
    const allowed = async (h) => {
      let p = 'denied';
      try { p = await h.queryPermission({ mode: 'read' }); } catch { return false; }
      if (p !== 'granted' && interactive) { try { p = await h.requestPermission({ mode: 'read' }); } catch { /* needs a user gesture */ } }
      return p === 'granted';
    };
    for (const d of s.dirs) if (!(await allowed(d))) return false;
    const entries = [];
    for (const it of s.items) {
      try {
        if (it.handle) {
          if (!(await allowed(it.handle))) continue;
          entries.push({ file: await it.handle.getFile(), handle: it.handle });
        } else {
          const dir = s.dirs[it.dir];
          let h = dir;
          for (const seg of it.path.slice(0, -1)) h = await h.getDirectoryHandle(seg);
          const fh = await h.getFileHandle(it.path[it.path.length - 1]);
          entries.push({ file: await fh.getFile(), handle: fh, dir, path: it.path });
        }
      } catch (err) { console.warn('could not restore', it, err); }
    }
    if (!entries.length) return false;
    this.resumeBtn.hidden = true;
    const before = this.images.length;
    await this.addEntries(entries);
    const target = before + Math.min(s.index, entries.length - 1);
    if (target !== this.index && target < this.images.length) await this.load(target);
    this.flash(`Reopened ${entries.length} photo(s) from last time.`);
    return true;
  }

  setSaveTo(where) {
    this.style.saveTo = where === 'download' ? 'download' : 'folder';
    this.saveToSelect.value = this.style.saveTo;
    saveJSON(STYLE_KEY, this.style);
    this.refresh();
  }

  async canWrite(dir) {
    try {
      let p = await dir.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted') p = await dir.requestPermission({ mode: 'readwrite' });
      return p === 'granted';
    } catch { return false; }
  }

  /** First free name among base, base_2, base_3 ... in dir. Never an existing file. */
  async uniqueName(dir, base) {
    const dot = base.lastIndexOf('.');
    const stem = base.slice(0, dot), ext = base.slice(dot);
    for (let n = 1; n < 10000; n++) {
      const name = n === 1 ? base : `${stem}_${n}${ext}`;
      try { await dir.getFileHandle(name); } catch (err) { if (err.name === 'NotFoundError') return name; }
    }
    throw new Error(`too many copies of ${base}`);
  }

  /** Write the labelled copy next to the original (same subfolder). Returns false if not possible. */
  async saveToFolder(im) {
    if (!im.dir) return false;
    if (!(await this.canWrite(im.dir))) return false;
    let target = im.dir;
    for (const seg of (im.path || []).slice(0, -1)) target = await target.getDirectoryHandle(seg);
    const blob = await this.saveBlob(im);
    const name = await this.uniqueName(target, this.outputName(im).name);
    const fh = await target.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    im.dirty = false;
    this.persist();
    this.flash(`Saved ${name} next to the original.`);
    return true;
  }

  /** Save one photo: into its folder when possible and wanted, otherwise as a download. */
  async save(im = this.current) {
    if (!im) return false;
    if (FS_ACCESS && this.style.saveTo === 'folder' && im.dir) {
      try { if (await this.saveToFolder(im)) return true; }
      catch (err) { console.warn('could not save into folder', im.name, err); this.flash(`Could not save into the folder (${err.message}); downloading instead.`); }
    }
    return this.download(im);
  }

  /** Decode a photo if it is not decoded yet. */
  ensure(im) {
    if (im.bitmap) return Promise.resolve(im.bitmap);
    if (!im.decoding) {
      im.decoding = this.decode(im.file).then((bmp) => {
        im.bitmap = bmp; im.width = bmp.width; im.height = bmp.height; im.decoding = null;
        return bmp;
      }, (err) => { im.decoding = null; im.broken = true; throw err; });
    }
    return im.decoding;
  }

  /** Free decoded pixels for photos that are not the current one or its neighbours. */
  trim() {
    this.images.forEach((im, i) => {
      if (Math.abs(i - this.index) <= 1 || !im.bitmap || im.decoding) return;
      if (typeof im.bitmap.close === 'function') im.bitmap.close();
      im.bitmap = null;
    });
  }

  /** Decode the neighbours in the background so N/P feel instant. */
  prefetch() {
    const run = () => {
      for (const j of [this.index + 1, this.index - 1]) {
        const im = this.images[j];
        if (im && !im.bitmap && !im.broken) this.ensure(im).catch(() => {});
      }
    };
    (window.requestIdleCallback || ((f) => setTimeout(f, 50)))(run);
  }

  async decode(file) {
    let blob = file;
    if (isHeic(file)) {
      let converted = null;
      try { converted = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* browser cannot decode HEIC natively */ }
      if (converted) return converted;
      const { heicTo } = await this.loadHeicDecoder();
      blob = await heicTo({ blob: file, type: 'image/png' });
    }
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => reject(new Error('undecodable image'));
        img.src = url;
      });
    }
  }

  loadHeicDecoder() {
    if (!Labeler._heicModule) {
      this.status('Loading HEIC decoder (one-time download)...');
      Labeler._heicModule = import(HEIC_DECODER_URL).catch((err) => {
        Labeler._heicModule = null;
        throw new Error(`HEIC decoder failed to load: ${err.message}`);
      });
    }
    return Labeler._heicModule;
  }

  setFormat(fmt) {
    this.style.format = fmt === 'png' ? 'png' : 'jpg';
    this.formatSelect.value = this.style.format;
    saveJSON(STYLE_KEY, this.style);
    this.refresh();
  }

  async load(i) {
    this.cancelEntry();
    this.index = i;
    this.selected = null;
    const im = this.current;
    const token = ++this._loadToken;
    if (!im.bitmap) {
      this.refresh();
      this.status(`Opening ${im.name}...`);
      try {
        await this.ensure(im);
      } catch (err) {
        console.warn('could not open', im.name, err);
        if (token !== this._loadToken) return;
        this.images.splice(i, 1);
        if (this.images.length) await this.load(Math.min(i, this.images.length - 1));
        else { this.index = -1; this.refresh(); }
        this.flash(`Could not open ${im.name}; removed from the queue.`);
        return;
      }
    }
    if (token !== this._loadToken) return;      // a newer load superseded this one
    this.trim();
    this.refresh();
    this.prefetch();
    this.saveSession();
  }

  step(d) {
    const n = this.index + d;
    if (n >= 0 && n < this.images.length) this.load(n);
    else this.flash(d > 0 ? 'No more photos that way.' : 'This is the first photo.');
  }

  /** Output is always the chosen format (JPG or PNG), whatever the input was. */
  outputName(im) {
    const dot = im.name.lastIndexOf('.');
    const stem = dot > 0 ? im.name.slice(0, dot) : im.name;
    const png = this.style.format === 'png';
    return { name: `${stem}_labeled.${png ? 'png' : 'jpg'}`, mime: png ? 'image/png' : 'image/jpeg' };
  }

  /** Full-resolution render of one (decoded) image. */
  renderFull(im = this.current) {
    if (!im.bitmap) throw new Error(`${im.name} is not decoded`);
    const cv = document.createElement('canvas');
    cv.width = im.width; cv.height = im.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(im.bitmap, 0, 0);
    drawLabels(ctx, im.labels, im.width, this.style, 1);
    return cv;
  }

  async saveBlob(im = this.current) {
    const { mime } = this.outputName(im);
    await this.ensure(im);
    const cv = this.renderFull(im);
    return new Promise((resolve) => cv.toBlob(resolve, mime, JPEG_QUALITY));
  }

  async download(im = this.current) {
    if (!im) return false;
    let blob;
    try { blob = await this.saveBlob(im); } catch (err) { console.warn('could not save', im.name, err); this.flash(`Could not open ${im.name}.`); return false; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.outputName(im).name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    im.dirty = false;
    this.persist();
    return true;
  }

  async saveAndNext() {
    if (!this.current) return;
    this.commitEntry();
    await this.save();
    if (this.index + 1 < this.images.length) this.load(this.index + 1);
    else { this.flash('All photos saved.'); this.refresh(); }
  }

  async saveAll() {
    this.commitEntry();
    for (const im of this.images) if (im.labels.length) await this.save(im);
    this.trim();
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
    if (!im || !im.bitmap) return;
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
  /** Redraw at most once per screen frame (used during drags and resizes). */
  requestRefresh() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.refresh(); });
  }

  /** The current photo pre-scaled to screen size, so a redraw is a cheap 1:1 blit
   *  instead of rescaling the full-resolution photo every time. */
  baseFor(im, dw, dh) {
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(dw * dpr)), ph = Math.max(1, Math.round(dh * dpr));
    const b = this.base;
    if (b && b.im === im && b.canvas.width === pw && b.canvas.height === ph) return b.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = pw; canvas.height = ph;
    canvas.getContext('2d').drawImage(im.bitmap, 0, 0, pw, ph);
    this.base = { im, canvas };
    return canvas;
  }

  refresh() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    this.layout();
    const im = this.current;
    const ctx = this.ctx;
    const cw = parseFloat(this.canvas.style.width), ch = parseFloat(this.canvas.style.height);
    ctx.clearRect(0, 0, cw, ch);
    this.dropEl.hidden = !!im;
    if (!im || !im.bitmap) { this.boxes = []; this.status(); return; }
    const dw = im.width * this.scale, dh = im.height * this.scale;
    ctx.drawImage(this.baseFor(im, dw, dh), this.offset[0], this.offset[1], dw, dh);
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
    const where = FS_ACCESS && s.saveTo === 'folder' && im.dir ? ' into its folder' : ' to Downloads';
    const base = `${im.name}${im.dirty ? ' *' : ''}  ·  labels: ${im.labels.length}${sel}  ·  text ${s.fontPct}%  square ${s.markerPct}%  colour ${s.fill}  ·  saves as ${s.format.toUpperCase()}${where}`;
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
    if (!this.current || !this.current.bitmap || e.button !== 0) return;
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
    this.requestRefresh();
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
    const { pos, tip, editing, fill } = this.entry;
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
      im.labels.push({ x: pos[0], y: pos[1], text, tip, fill, marker: this.style.markerPct });
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
    fill = fill.toUpperCase();
    if (this.selected !== null && this.current) { this.snapshot(); this.current.labels[this.selected].fill = fill; this.changed(); }
    else { this.style.fill = fill; saveJSON(STYLE_KEY, this.style); this.refresh(); }
    if (this.entry) {
      // a label is being typed: show the new colour right away, not only after Enter
      this.entry.fill = fill;
      this.entryEl.style.background = fill; this.entryEl.style.color = outlineFor(fill);
      this.entryEl.focus();
      this.refresh();
    }
  }
  cycleColour() {
    const list = this.presets();
    const i = list.indexOf(this.currentColour());
    this.applyColour(list[(i + 1) % list.length]);
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
      o: () => this.openPhotos(), f: () => this.openFolder(), '?': () => this.action('help'),
    };
    if (e.ctrlKey && !['z', 'y'].includes(k)) return;
    if (acts[k]) { e.preventDefault(); acts[k](); }
  }
}
