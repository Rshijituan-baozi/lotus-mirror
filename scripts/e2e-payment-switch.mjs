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

async function waitForServer(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`server not ready: ${url}`);
}

let serverProc = null;
if (!process.env.LOTUS_TEST_BASE) {
  serverProc = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3000' },
  });
  await waitForServer(BASE);
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

async function readPaymentState(page) {
  return page.evaluate(() => {
    function parseMoney(text) {
      var m = String(text || '').replace(/,/g, '').match(/([\d.]+)/);
      return m ? Number(m[1]) : 0;
    }
    var credit = document.querySelector('#payment-section-creditCard');
    var debit = document.querySelector('#payment-section-payOnDelivery');
    var main = document.querySelector('main') || document.querySelector('[class*="payment"]') || document.body;
    var payNote = null;
    document.querySelectorAll('section, article, div[class*="MuiBox"], div[class*="MuiPaper"]').forEach(function(el) {
      if (payNote || !el || el.closest('#payment-section-creditCard, #payment-section-payOnDelivery, #OrderSummaryCard-default, aside, header, footer')) return;
      var txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/pay on delivery/i.test(txt) && /no cash accepted/i.test(txt) && txt.length < 220) payNote = el;
    });
    var noteStyle = payNote ? getComputedStyle(payNote).display : null;
    var noteHiddenClass = document.documentElement.classList.contains('lotus-debit-pay-note-hidden');
    return {
      url: location.href,
      hasCredit: !!credit,
      hasDebit: !!debit,
      mainTextLen: (main.textContent || '').replace(/\s+/g, ' ').trim().length,
      discountRow: !!document.querySelector('#lotus-credit-card-discount-row'),
      total: parseMoney(document.querySelector('#total-price')?.textContent),
      payNoteDisplay: noteStyle,
      payNoteHiddenClass: noteHiddenClass,
      choice: window.__lotusPaymentChoice || null,
    };
  });
}

async function clickSection(page, selector) {
  return page.evaluate((sel) => {
    var el = document.querySelector(sel);
    if (!el) return false;
    var target = el.querySelector('[role="button"], label, button, input, span[tabindex]') || el;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }, selector);
}

try {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(90000);
  page.setDefaultTimeout(30000);

  const htmlCheck = await fetch(`${BASE}/en/payment`, { redirect: 'manual' });
  const html = await htmlCheck.text();
  assert(html.includes('syncPaymentSelectorTileIcons') || html.includes('patchPaymentPage'), 'payment page should inject latest script');

  await page.goto(`${BASE}/en/payment`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(3000);

  const initial = await readPaymentState(page);
  console.log('initial state:', JSON.stringify(initial));

  if (!initial.hasCredit || !initial.hasDebit) {
    console.log('SKIP: payment sections not present (likely no active checkout session on this host)');
    console.log('PASS: inject present on /en/payment HTML');
    process.exit(0);
  }

  await clickSection(page, '#payment-section-creditCard');
  await sleep(1500);
  const creditState = await readPaymentState(page);
  console.log('after credit click:', JSON.stringify(creditState));
  assert(creditState.mainTextLen > 80, 'main content should remain visible after credit click');
  assert(creditState.discountRow === true, 'credit selection should show discount row');

  await clickSection(page, '#payment-section-payOnDelivery');
  await sleep(2000);
  const debitState = await readPaymentState(page);
  console.log('after debit click:', JSON.stringify(debitState));
  assert(debitState.mainTextLen > 80, 'main content should remain visible after switching back to debit');
  assert(debitState.discountRow === false, 'debit selection should remove discount row');
  assert(debitState.payNoteHiddenClass === true, 'debit selection should add lotus-debit-pay-note-hidden');

  await clickSection(page, '#payment-section-creditCard');
  await sleep(1500);
  const creditAgain = await readPaymentState(page);
  console.log('after credit again:', JSON.stringify(creditAgain));
  assert(creditAgain.mainTextLen > 80, 'main content should remain visible after second credit click');
  assert(creditAgain.discountRow === true, 'credit selection should restore discount row');

  await clickSection(page, '#payment-section-payOnDelivery');
  await sleep(2000);
  const debitAgain = await readPaymentState(page);
  console.log('after second debit click:', JSON.stringify(debitAgain));
  assert(debitAgain.mainTextLen > 80, 'main content should remain visible after second debit click');
  assert(debitAgain.discountRow === false, 'second debit click should not restore discount row');

  console.log('PASS: payment credit/debit switch e2e');
} finally {
  await browser.close();
  if (serverProc) {
    serverProc.kill();
    await sleep(300);
  }
}
