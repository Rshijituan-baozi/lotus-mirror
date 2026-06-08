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
  const start = Date.now();
  while (Date.now() - start < 30000) {
    try {
      const r = await fetch(BASE);
      if (r.status < 500) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('server not ready');
}

try {
  await waitForServer();
  const url = `${BASE}/__api/shoponline-bffapi.lotuss.com.my/v1/cart/validation?websiteCode=malaysia_hy&totalPrice=65.2`;
  const r = await fetch(url);
  const text = await r.text();
  if (r.status !== 200) throw new Error(`expected 200, got ${r.status}: ${text}`);
  const json = JSON.parse(text);
  if (!json.success) throw new Error(`expected success response: ${text}`);
  console.log('PASS: server validation mock returns 200');
  console.log('body:', text);
} finally {
  serverProc.kill();
  await sleep(300);
}
