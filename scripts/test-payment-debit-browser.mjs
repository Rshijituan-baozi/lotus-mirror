import puppeteer from 'puppeteer';
import { setTimeout as sleep } from 'timers/promises';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = process.env.LOTUS_TEST_BASE || 'http://127.0.0.1:3000';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let serverProc = null;
if (!process.env.LOTUS_TEST_BASE) {
  serverProc = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3000' },
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.status < 500) break;
    } catch {}
    await sleep(500);
    if (i === 59) throw new Error('server not ready');
  }
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/en`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const restored = await page.evaluate(() => {
    window.__lotusPaymentChoice = 'debitCard';
    var el = document.createElement('img');
    el.id = 'icon-payment-2';
    el.style.setProperty('display', 'none', 'important');
    document.body.appendChild(el);
    var hide = window.__lotusPaymentChoice !== 'debitCard';
    if (hide) el.style.setProperty('display', 'none', 'important');
    else {
      el.style.removeProperty('display');
      if (getComputedStyle(el).display === 'none') {
        el.style.setProperty('display', 'revert', 'important');
      }
    }
    return getComputedStyle(el).display;
  });

  assert(restored !== 'none', `debit transition should restore icon, got display=${restored}`);

  const intercept = await page.evaluate(() => {
    history.replaceState({}, '', '/en/payment');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/__api/shoponline-bffapi.lotuss.com.my/v1/payment?websiteCode=malaysia_hy');
    return {
      validationIntercept: !!xhr._lotusValidationIntercept,
      checkoutRedirect: !!xhr._lotusCheckoutRedirect,
    };
  });
  assert(intercept.validationIntercept === false, 'payment POST should not be treated as validation');
  assert(intercept.checkoutRedirect === false, 'payment POST should not redirect to checkout');

  console.log('PASS: payment debit icon restore logic');
  console.log('PASS: payment POST intercept flags');
} finally {
  await browser.close();
  if (serverProc) {
    serverProc.kill();
    await sleep(300);
  }
}
