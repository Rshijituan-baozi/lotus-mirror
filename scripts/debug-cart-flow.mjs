import puppeteer from 'puppeteer';
import { setTimeout as sleep } from 'timers/promises';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

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
    await sleep(500);
  }
  throw new Error('server not ready');
}

await waitForServer();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

try {
  await page.goto(`${BASE}/en/product/lotuss-ss-3tier-steamer-32cm-74718282`, { waitUntil: 'networkidle2', timeout: 120000 });
  console.log('product url:', page.url());

  const injectOk = await page.evaluate(() => {
    return typeof window.fetch === 'function'
      && /validation/i.test('validation?websiteCode=malaysia_hy');
  });
  console.log('basic page ok:', injectOk);

  const hasInject = await page.content();
  console.log('inject in html:', hasInject.includes('isCheckoutInterceptUrl') || hasInject.includes('fakeCheckoutFetchResponse'));

  const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button,[role="button"]')).slice(0, 20).map(b => (b.textContent || '').trim().slice(0, 40)));
  console.log('buttons:', buttons);

  const addBtn = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
    return buttons.find(b => /add to cart|add to bag|tambah/i.test((b.textContent || '').trim()));
  });
  if (addBtn.asElement()) {
    await addBtn.asElement().click();
    await sleep(8000);
  }
  console.log('after add url:', page.url());

  for (const cartPath of ['/en/cart', '/en/my-cart', '/cart', '/en/shopping-cart']) {
    await page.goto(`${BASE}${cartPath}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null);
    const text = await page.evaluate(() => (document.body && document.body.innerText || '').slice(0, 600));
    console.log('\n--- cart path', cartPath, 'final', page.url(), '---');
    console.log(text.replace(/\s+/g, ' ').slice(0, 400));
  }
} finally {
  await browser.close();
  serverProc.kill();
}
