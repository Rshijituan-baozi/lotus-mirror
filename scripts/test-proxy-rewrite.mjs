import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:3004';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const serverProc = spawn(process.execPath, ['src/index.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: '3004' },
});

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.status < 500) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('server not ready');
}

try {
  await waitForServer();
  const html = await fetch(BASE).then((r) => r.text());
  assert(!/https?:\/\/(?:www\.)?myneoflam\.com/i.test(html), 'HTML should not contain absolute myneoflam.com URLs after rewrite');
  assert(html.includes('<base href="/">'), 'HTML should inject base tag');
  assert(html.includes('function rewriteUrl'), 'HTML should inject neoflam inject.js');
  assert(html.includes('isShopifyCheckoutUrl'), 'HTML should include checkout guard');

  const inject = fs.readFileSync(path.join(ROOT, 'src', 'inject.js'), 'utf8');
  assert(inject.includes('redirectToCheckout'), 'inject should define redirectToCheckout');
  assert(inject.includes('bindCheckoutButtons'), 'inject should bind checkout buttons');

  console.log('test:proxy-rewrite OK');
} finally {
  serverProc.kill();
  await sleep(300);
}
