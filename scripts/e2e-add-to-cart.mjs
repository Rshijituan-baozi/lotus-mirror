import puppeteer from 'puppeteer';
import { setTimeout as sleep } from 'timers/promises';

const BASE = process.env.LOTUS_TEST_BASE || 'http://127.0.0.1:3000';
const PRODUCT_URL = `${BASE}/en/product/lotuss-ss-3tier-steamer-32cm-74718282`;

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(String(err)));

  await page.goto(PRODUCT_URL, { waitUntil: 'networkidle2', timeout: 120000 });
  if (page.url().includes('/errors/500')) {
    throw new Error('product page redirected to 500');
  }

  await page.waitForFunction(() => {
    const text = document.body && document.body.innerText || '';
    return /59\.90|74718282|Add to Cart|Add To Cart|Tambah/i.test(text);
  }, { timeout: 120000 });

  const addBtn = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
    return buttons.find(b => /add to cart|add to bag|tambah ke troli|add item/i.test((b.textContent || '').trim()))
      || buttons.find(b => /add/i.test(b.getAttribute('aria-label') || ''))
      || buttons.find(b => b.className && /add.*cart|cart.*add/i.test(String(b.className)));
  });
  const btnEl = addBtn.asElement();
  if (!btnEl) {
    const snippet = await page.evaluate(() => (document.body.innerText || '').slice(0, 500));
    throw new Error(`Add to cart button not found. Body snippet: ${snippet}`);
  }

  await Promise.all([
    page.waitForResponse(res => (res.url().includes('/graphql') || res.url().includes('/__api/')) && res.status() < 500, { timeout: 60000 }).catch(() => null),
    btnEl.click(),
  ]);
  await sleep(8000);

  const finalUrl = page.url();
  if (finalUrl.includes('/errors/500')) {
    throw new Error(`redirected to 500 after add to cart: ${finalUrl}`);
  }

  console.log('PASS: add to cart did not hit 500');
  console.log('final url:', finalUrl);
  if (consoleErrors.length) {
    console.log('console errors (non-fatal):', consoleErrors.slice(0, 5));
  }
} finally {
  await browser.close();
}
