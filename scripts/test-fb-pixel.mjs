import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { getPublicSettings } from '../src/fb-pixels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const proxySrc = fs.readFileSync(path.join(ROOT, 'src', 'proxy.js'), 'utf8');
assert(
  proxySrc.includes('/js/lotus-fb-pixel.js'),
  'proxy.js headPatch must include /js/lotus-fb-pixel.js',
);
console.log('PASS: proxy.js headPatch includes lotus-fb-pixel.js');

const pixelSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'lotus-fb-pixel.js'), 'utf8');
assert(
  /enabled\s*!==\s*false/.test(pixelSrc) && pixelSrc.includes('PageView'),
  'lotus-fb-pixel.js must filter enabled pixels and track PageView',
);
console.log('PASS: lotus-fb-pixel.js filters enabled + PageView');

const injectSrc = fs.readFileSync(path.join(ROOT, 'src', 'inject.js'), 'utf8');
assert(
  injectSrc.includes("trackLotusFb('AddToCart'") && injectSrc.includes("trackLotusFb('InitiateCheckout'"),
  'inject.js redirectToCheckout must track AddToCart and InitiateCheckout',
);
console.log('PASS: inject.js tracks AddToCart + InitiateCheckout');

const checkoutHtml = fs.readFileSync(path.join(ROOT, 'public', 'checkout', 'index.html'), 'utf8');
assert(
  checkoutHtml.includes('lotus-fb-pixel.js') && checkoutHtml.includes("trackLotusFb('Purchase'"),
  'checkout/index.html must load pixel script and track Purchase in doSubmit',
);
console.log('PASS: checkout/index.html loads pixel + Purchase');

const completeHtml = fs.readFileSync(path.join(ROOT, 'public', 'complete', 'index.html'), 'utf8');
assert(
  completeHtml.includes('lotus-fb-pixel.js') && completeHtml.includes('lotusFbPurchaseComplete'),
  'complete/index.html must load pixel script and dedupe Purchase',
);
console.log('PASS: complete/index.html loads pixel + Purchase dedupe');

const indexSrc = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8');
assert(
  indexSrc.includes("'/settings'") && indexSrc.includes("'/api/settings'"),
  'index.js /api/settings must try both upstream paths',
);
console.log('PASS: index.js tries /api/settings and /settings');

const settings = getPublicSettings();
assert(Array.isArray(settings.fbPixels), 'getPublicSettings().fbPixels must be an array');
console.log('PASS: local settings fallback shape OK');

const TEST_PORT = 31987;
const serverProc = spawn(process.execPath, ['src/index.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(TEST_PORT) },
});
serverProc.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${TEST_PORT}/api/settings`);
      if (r.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('server not ready');
}

try {
  await sleep(500);
  await waitForServer();
  const base = `http://127.0.0.1:${TEST_PORT}`;

  const r = await fetch(`${base}/api/settings`);
  assert(r.ok, `/api/settings expected 200, got ${r.status}`);
  const json = await r.json();
  assert(json.data && Array.isArray(json.data.fbPixels), '/api/settings response must include data.fbPixels');
  console.log('PASS: live /api/settings returns fbPixels array');

  const jsRes = await fetch(`${base}/js/lotus-fb-pixel.js`);
  assert(jsRes.ok, `/js/lotus-fb-pixel.js expected 200, got ${jsRes.status}`);
  console.log('PASS: /js/lotus-fb-pixel.js is served');

  console.log('test:fb-pixel OK');
} finally {
  serverProc.kill();
  await sleep(300);
}
