import puppeteer from 'puppeteer';
import { setTimeout as sleep } from 'timers/promises';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:3000';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

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

let serverProc = spawn(process.execPath, ['src/index.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: '3000' },
});
serverProc.stderr.on('data', (chunk) => process.stderr.write(chunk));
await sleep(1000);
await waitForServer();

try {
  const serverRes = await fetch(`${BASE}/en/payment/success`, { redirect: 'manual' });
  assert(serverRes.status === 302, `server redirect expected 302, got ${serverRes.status}`);
  const location = serverRes.headers.get('location') || '';
  assert(/\/checkout\/?$/i.test(location), `server redirect location expected /checkout/, got ${location}`);
  console.log('PASS: server payment/success redirects to /checkout/');

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/en/payment/success`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert(/\/checkout\/?$/i.test(page.url()), `browser visit success expected /checkout/, got ${page.url()}`);
    console.log('PASS: browser visit /en/payment/success ends on /checkout/');

    await page.goto(`${BASE}/en/payment`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const validationResult = await page.evaluate(() => {
      window.__lotusCheckoutRedirected = false;
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'validation?websiteCode=malaysia_hy&totalPrice=168.08&storeId=5502');
      xhr.send();
      return { redirected: !!window.__lotusCheckoutRedirected };
    });
    assert(validationResult.redirected === true, `payment validation expected redirect, got ${JSON.stringify(validationResult)}`);
    console.log('PASS: payment validation redirects to /checkout/');

    await page.goto(`${BASE}/en/payment`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const pushResult = await page.evaluate(() => {
      window.__lotusCheckoutRedirected = false;
      history.pushState({}, '', '/en/payment/success');
      return { redirected: !!window.__lotusCheckoutRedirected };
    });
    assert(pushResult.redirected === true, `pushState guard expected redirect flag, got ${JSON.stringify(pushResult)}`);
    console.log('PASS: client pushState payment/success sets checkout redirect flag');
  } finally {
    await browser.close();
  }

  console.log('test:payment-success-redirect OK');
} finally {
  serverProc.kill();
  await sleep(300);
}
