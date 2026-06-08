import puppeteer from 'puppeteer';
import { setTimeout as sleep } from 'timers/promises';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = process.env.LOTUS_TEST_BASE || 'http://127.0.0.1:3000';
const PRODUCT_URL = `${BASE}/en/product/lotuss-ss-3tier-steamer-32cm-74718282`;

function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  return (async function poll() {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error(`server not ready: ${url}`);
    await sleep(500);
    return poll();
  })();
}

let serverProc = null;
if (!process.env.LOTUS_TEST_BASE) {
  serverProc = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3000' },
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(d));
  serverProc.stderr.on('data', (d) => process.stderr.write(d));
  await waitForServer(BASE);
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  let validationHit = false;
  page.on('request', (req) => {
    if (/validation/i.test(req.url())) validationHit = true;
  });

  await page.goto(PRODUCT_URL, { waitUntil: 'networkidle2', timeout: 120000 });
  if (page.url().includes('/errors/500')) throw new Error('product page redirected to 500');

  await page.waitForFunction(() => {
    const text = document.body && document.body.innerText || '';
    return /59\.90|74718282|Add to Cart|Add To Cart|Tambah/i.test(text);
  }, { timeout: 120000 });

  const addBtn = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
    return buttons.find(b => /add to cart|add to bag|tambah ke troli|add item/i.test((b.textContent || '').trim()))
      || buttons.find(b => /add/i.test(b.getAttribute('aria-label') || ''));
  });
  const btnEl = addBtn.asElement();
  if (!btnEl) throw new Error('Add to cart button not found');

  await Promise.all([
    page.waitForResponse(res => (res.url().includes('/graphql') || res.url().includes('/__api/')) && res.status() < 500, { timeout: 60000 }).catch(() => null),
    btnEl.click(),
  ]);
  await sleep(5000);

  const cartUrl = `${BASE}/en/cart`;
  await page.goto(cartUrl, { waitUntil: 'networkidle2', timeout: 120000 });
  if (page.url().includes('/errors/500')) throw new Error(`cart page redirected to 500: ${page.url()}`);

  await page.waitForFunction(() => {
    const text = document.body && document.body.innerText || '';
    return /place\s+order|my cart|troli|59\.90/i.test(text);
  }, { timeout: 120000 });

  const placeOrderBtn = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]'));
    return buttons.find(b => /place\s+order/i.test((b.textContent || b.value || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()));
  });
  const placeEl = placeOrderBtn.asElement();
  if (!placeEl) {
    const snippet = await page.evaluate(() => (document.body.innerText || '').slice(0, 800));
    throw new Error(`Place Order button not found. Body snippet: ${snippet}`);
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
    placeEl.click(),
  ]);
  await sleep(2000);

  const finalUrl = page.url();
  const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '');
  const hasErrorModal = /your order total has been changed|please check your order total/i.test(bodyText);

  if (hasErrorModal) {
    throw new Error('DIFFERENT_PRICE modal still visible after Place Order');
  }
  if (!finalUrl.includes('/checkout')) {
    throw new Error(`expected redirect to /checkout/, got: ${finalUrl}`);
  }

  const order = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('lotus_order') || '{}'); } catch { return {}; }
  });
  if (!order.amount || Number(order.amount) <= 0) {
    console.warn('WARN: lotus_order.amount missing, got:', order);
  }

  console.log('PASS: Place Order redirected to checkout without price modal');
  console.log('final url:', finalUrl);
  console.log('lotus_order.amount:', order.amount || '(empty)');
  console.log('validation request observed:', validationHit);
} finally {
  await browser.close();
  if (serverProc) {
    serverProc.kill();
    await sleep(500);
  }
}
