// Offline check for the service worker, driven through headless Chrome.
//
//   1. serve the repo root:      python -m http.server 8765
//   2. node web-test/sw-check.mjs online     (loads the app, fetches the HEIC decoder)
//   3. stop the server, then:    node web-test/sw-check.mjs offline
//      -> app shell and decoder must come from the service worker cache,
//         with cdn.jsdelivr.net made unresolvable, and a HEIC must still decode.
//
// Needs Node 22+ (built-in fetch and WebSocket) and Chrome on Windows/macOS/Linux.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const phase = process.argv[2];
if (!['online', 'offline'].includes(phase)) { console.error('usage: node sw-check.mjs online|offline'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const PROFILE = join(tmpdir(), 'bbl-sw-check-profile');
const APP = 'http://127.0.0.1:8765/docs/';
const PORT = 9334;
const sample = readFileSync(join(here, 'sample.heic')).toString('base64');

const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--window-size=1200,900', 'about:blank'];
if (phase === 'offline') args.push('--host-resolver-rules=MAP cdn.jsdelivr.net ~NOTFOUND');
const chrome = spawn(CHROME, args, { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let id = 0; const pending = new Map(); let ws; const swLogs = [];
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const msgId = ++id; pending.set(msgId, { resolve, reject });
  ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} [${phase}] ${msg}`); if (!cond) failures++; };

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {} await sleep(100); }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'service_worker') send('Runtime.enable', {}, m.params.sessionId);
    else if (m.method === 'Runtime.exceptionThrown' && m.sessionId) swLogs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send('Page.navigate', { url: APP });
  await sleep(1500);
  check((await evaluate('document.title')) === 'Breadboard Labeler', 'app page loaded');
  let controlled = false;
  for (let i = 0; i < 50 && !controlled; i++) { controlled = await evaluate('!!navigator.serviceWorker.controller'); if (!controlled) await sleep(200); }
  check(controlled, 'page is controlled by the service worker');

  const decoded = await evaluate(`(async () => {
    const t0 = performance.now();
    await labeler.loadHeicDecoder();
    const ms = Math.round(performance.now() - t0);
    const bytes = Uint8Array.from(atob('${sample}'), (c) => c.charCodeAt(0));
    const bmp = await labeler.decode(new File([bytes], 'IMG_test.heic', { type: 'image/heic' }));
    return { ms, w: bmp.width, h: bmp.height };
  })()`);
  check(decoded.w === 640 && decoded.h === 480, `HEIC decoded to ${decoded.w}x${decoded.h} (decoder ready in ${decoded.ms} ms)`);
  await sleep(1500);   // let the service worker finish writing the cache
  const cached = await evaluate(`caches.keys().then(async (names) => { const out = {}; for (const n of names) out[n] = (await (await caches.open(n)).keys()).map((k) => k.url); return out; })`);
  const names = Object.keys(cached);
  const withDecoder = names.filter((n) => cached[n].some((u) => u.includes('heic-to')));
  check(withDecoder.length === 1, `decoder is in the service worker cache (${names.map((n) => `${n}: ${cached[n].length} entries`).join(', ')})`);
  check(names.length === 1, 'old cache versions were cleaned up');
  if (phase === 'offline') {
    let cdnReachable = true;
    try { await evaluate(`fetch('https://cdn.jsdelivr.net/npm/heic-to@1.5.2/package.json', { cache: 'no-store' }).then(() => true)`); } catch { cdnReachable = false; }
    check(!cdnReachable, 'CDN really was unreachable (so the decoder came from the cache)');
    const perf = await evaluate(`JSON.stringify(performance.getEntriesByType('resource').map((e) => [e.name.split('/').pop(), e.transferSize]))`);
    console.log(`INFO [offline] resource transfer sizes: ${perf}`);
  }
  check(swLogs.length === 0, swLogs.length ? `service worker threw: ${swLogs[0]}` : 'service worker threw no exceptions');
} catch (e) {
  check(false, `error: ${e.message}`);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  console.log(`${phase}: ${failures ? failures + ' FAILURE(S)' : 'all checks passed'}`);
  process.exitCode = failures ? 1 : 0;
}
