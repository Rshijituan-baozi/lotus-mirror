import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:3000';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const serverProc = spawn(process.execPath, ['src/index.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: '3000' },
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

  const payRes = await fetch(`${BASE}/en/payment/pay`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Referer: `${BASE}/en/payment` },
  });
  assert(payRes.status === 302, `payment pay POST expected 302, got ${payRes.status}`);
  assert((payRes.headers.get('location') || '').includes('/checkout'), `payment pay redirect location: ${payRes.headers.get('location')}`);
  console.log('PASS: payment pay POST redirects to /checkout/');

  console.log('test:proxy-cybersource-redirect OK');
} finally {
  serverProc.kill();
  await sleep(300);
}
