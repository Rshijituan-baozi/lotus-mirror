import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:3000';

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
    await sleep(300);
  }
  throw new Error('server not ready');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

try {
  await waitForServer();

  const upstreamLike = `${BASE}/__api/shoponline-bffapi.lotuss.com.my/v1/cart/validation?websiteCode=malaysia_hy&totalPrice=65.2&storeId=5502`;
  const r1 = await fetch(upstreamLike);
  const t1 = await r1.text();
  assert(r1.status === 200, `middleware validation expected 200, got ${r1.status}: ${t1}`);
  assert(t1.includes('"success":true'), t1);

  const errJson = JSON.stringify({ error: { code: 40001, type: 'DIFFERENT_PRICE' } });
  const r2 = await fetch(`${BASE}/__api/shoponline-bffapi.lotuss.com.my/v1/cart/validation?websiteCode=malaysia_hy&totalPrice=65.2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: errJson,
  });
  const t2 = await r2.text();
  assert(r2.status === 200, `POST validation should bypass upstream, got ${r2.status}: ${t2}`);

  console.log('PASS: express validation bypass middleware');
} finally {
  serverProc.kill();
  await sleep(300);
}
