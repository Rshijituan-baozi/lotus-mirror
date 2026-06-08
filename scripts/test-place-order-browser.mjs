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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

await waitForServer();

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

async function runClientInterceptTest(label, runner, options = {}) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Location.prototype.replace = function(url) {
      window.__lotusReplaceUrl = String(url);
    };
  });
  try {
    await page.setDefaultNavigationTimeout(20000);
    await page.goto(`${BASE}${options.path || '/en'}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const result = await runner(page);
    if (!options.skipSuccessCheck) {
      assert(result.status === 200, `${label} status expected 200, got ${JSON.stringify(result)}`);
      assert(String(result.body || result.json?.success) && (result.json?.success === true || String(result.body).includes('"success":true')),
        `${label} body expected success, got ${JSON.stringify(result)}`);
    }
    if (options.expectNoCheckoutRedirect) {
      assert(result.checkoutRedirect === false, `${label} should not mark checkout redirect, got ${JSON.stringify(result)}`);
    }
    if (options.expectNoValidationIntercept) {
      assert(result.validationIntercept === false, `${label} should not intercept as validation, got ${JSON.stringify(result)}`);
    }
    if (options.expectRedirect) {
      assert(result.redirected === true, `${label} should mark checkout redirect`);
      if (!options.skipOrderCheck) {
        assert(result.order && result.order.currency === 'MYR', `${label} should save lotus_order, got ${JSON.stringify(result.order)}`);
      }
    } else if (result.redirected) {
      throw new Error(`${label} should not redirect to /checkout/`);
    }
    console.log(`PASS: ${label}`);
  } finally {
    await page.close();
  }
}

try {
  await runClientInterceptTest('fetch validation intercept', (page) => page.evaluate(async () => {
    window.__lotusCheckoutRedirected = false;
    try { localStorage.removeItem('lotus_order'); } catch {}
    const res = await fetch('validation?websiteCode=malaysia_hy&totalPrice=65.2&storeId=5502');
    const json = await res.json();
    let order = null;
    try { order = JSON.parse(localStorage.getItem('lotus_order') || 'null'); } catch {}
    return {
      status: res.status,
      json,
      body: JSON.stringify(json),
      redirected: !!window.__lotusCheckoutRedirected,
      order,
    };
  }), { expectRedirect: false });

  await runClientInterceptTest('xhr validation intercept', (page) => page.evaluate(() => new Promise((resolve, reject) => {
    var timer = setTimeout(function() { reject(new Error('xhr timeout')); }, 8000);
    window.__lotusCheckoutRedirected = false;
    try { localStorage.removeItem('lotus_order'); } catch {}
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'validation?websiteCode=malaysia_hy&totalPrice=65.2');
    xhr.onload = function() {
      clearTimeout(timer);
      let order = null;
      try { order = JSON.parse(localStorage.getItem('lotus_order') || 'null'); } catch {}
      resolve({
        status: xhr.status,
        body: xhr.responseText,
        redirected: !!window.__lotusCheckoutRedirected,
        order,
      });
    };
    xhr.onerror = function() { clearTimeout(timer); reject(new Error('xhr error')); };
    xhr.send();
  })), { expectRedirect: false });

  await runClientInterceptTest('payment POST should not use validation intercept', (page) => page.evaluate(() => {
    history.replaceState({}, '', '/en/payment');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/__api/shoponline-bffapi.lotuss.com.my/v1/payment?websiteCode=malaysia_hy');
    return {
      validationIntercept: !!xhr._lotusValidationIntercept,
      checkoutRedirect: !!xhr._lotusCheckoutRedirect,
      redirected: !!window.__lotusCheckoutRedirected,
    };
  }), { path: '/en/payment', expectRedirect: false, skipSuccessCheck: true, expectNoValidationIntercept: true });

  const apiResult = await fetch(`${BASE}/__api/shoponline-bffapi.lotuss.com.my/v1/cart/validation?websiteCode=malaysia_hy&totalPrice=65.2`);
  const apiText = await apiResult.text();
  assert(apiResult.status === 200, `server validation mock expected 200, got ${apiResult.status}: ${apiText}`);
  assert(apiText.includes('"success":true'), `server validation mock body: ${apiText}`);

  await runClientInterceptTest('payment page GET should not redirect', (page) => page.evaluate(() => {
    history.replaceState({}, '', '/en/payment');
    window.__lotusCheckoutRedirected = false;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/__api/shoponline-bffapi.lotuss.com.my/v1/payment/methods?websiteCode=malaysia_hy');
    return {
      checkoutRedirect: !!xhr._lotusCheckoutRedirect,
      validationIntercept: !!xhr._lotusValidationIntercept,
      redirected: !!window.__lotusCheckoutRedirected,
    };
  }), { path: '/en/payment', expectRedirect: false, skipSuccessCheck: true, expectNoCheckoutRedirect: true });

  await runClientInterceptTest('cybersource config GET should not redirect', (page) => page.evaluate(() => {
    history.replaceState({}, '', '/en/payment');
    window.__lotusCheckoutRedirected = false;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/cybersource/config');
    return {
      checkoutRedirect: !!xhr._lotusCheckoutRedirect,
      redirected: !!window.__lotusCheckoutRedirected,
    };
  }), { path: '/en/payment', expectRedirect: false, skipSuccessCheck: true, expectNoCheckoutRedirect: true });

  await runClientInterceptTest('cybersource config POST should not redirect on payment', (page) => page.evaluate(() => {
    history.replaceState({}, '', '/en/payment');
    window.__lotusCheckoutRedirected = false;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/cybersource/config');
    xhr.send();
    return {
      checkoutRedirect: !!xhr._lotusCheckoutRedirect,
      redirected: !!window.__lotusCheckoutRedirected,
    };
  }), { path: '/en/payment', expectRedirect: false, skipSuccessCheck: true, expectNoCheckoutRedirect: true });

  await runClientInterceptTest('debit place order POST should redirect', (page) => page.evaluate(() => {
    history.replaceState({}, '', '/en/payment');
    window.__lotusCheckoutRedirected = false;
    window.__lotusPaymentChoice = 'debitCard';
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/__api/shoponline-bffapi.lotuss.com.my/v1/order/placeOrder?websiteCode=malaysia_hy');
    xhr.send();
    return {
      checkoutRedirect: !!xhr._lotusCheckoutRedirect,
      redirected: !!window.__lotusCheckoutRedirected,
    };
  }), { path: '/en/payment', expectRedirect: true, skipSuccessCheck: true, skipOrderCheck: true });

  await runClientInterceptTest('cybersource checkout request should redirect', (page) => page.evaluate(() => {
    history.replaceState({}, '', '/en/payment');
    window.__lotusCheckoutRedirected = false;
    var xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://secureacceptance.cybersource.com/checkout');
    xhr.send();
    return {
      checkoutRedirect: !!xhr._lotusCheckoutRedirect,
      redirected: !!window.__lotusCheckoutRedirected,
    };
  }), { path: '/en/payment', expectRedirect: true, skipSuccessCheck: true, skipOrderCheck: true });

  await runClientInterceptTest('cybersource form submit should redirect', (page) => page.evaluate(() => {
    history.replaceState({}, '', '/en/payment');
    window.__lotusCheckoutRedirected = false;
    var form = document.createElement('form');
    form.action = 'https://secureacceptance.cybersource.com/checkout';
    form.method = 'POST';
    document.body.appendChild(form);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return { redirected: !!window.__lotusCheckoutRedirected };
  }), { path: '/en/payment', expectRedirect: true, skipSuccessCheck: true, skipOrderCheck: true });

  await runClientInterceptTest('payment page validation should pass through', (page) => page.evaluate(() => {
    history.replaceState({}, '', '/en/payment');
    window.__lotusCheckoutRedirected = false;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/__api/api-o2o.lotuss.com.my/lotuss-mobile-bff/cart/v1/carts/test/validation?websiteCode=malaysia_hy&totalPrice=168.08');
    return {
      validationIntercept: !!xhr._lotusValidationIntercept,
      checkoutRedirect: !!xhr._lotusCheckoutRedirect,
      redirected: !!window.__lotusCheckoutRedirected,
    };
  }), { path: '/en/payment', expectRedirect: false, skipSuccessCheck: true, expectNoCheckoutRedirect: true });

  await runClientInterceptTest('credit default discount after dom sync', async (page) => {
    await page.evaluate(() => {
      history.replaceState({}, '', '/en/payment');
      window.__lotusPaymentUserPicked = false;
      delete window.__lotusPaymentChoice;
      document.body.innerHTML = [
        '<div id="payment-section-creditCard"><input type="radio" checked></div>',
        '<div id="payment-section-payOnDelivery"><input type="radio"></div>',
        '<div id="OrderSummaryCard-default"><div><div><hr></div></div></div>',
        '<div id="total-price">RM 100.00</div>',
      ].join('');
    });
    await page.waitForFunction(
      () => window.__lotusPaymentChoice === 'creditCard' && !!document.querySelector('#lotus-credit-card-discount-row'),
      { timeout: 6000 }
    );
    const result = await page.evaluate(() => ({
      choice: window.__lotusPaymentChoice,
      discountRow: !!document.querySelector('#lotus-credit-card-discount-row'),
      total: document.querySelector('#total-price') && document.querySelector('#total-price').textContent,
    }));
    assert(result.discountRow, `credit default discount expected, got ${JSON.stringify(result)}`);
    assert(result.choice === 'creditCard', `expected creditCard choice, got ${JSON.stringify(result)}`);
    return result;
  }, { path: '/en/payment', skipSuccessCheck: true, skipOrderCheck: true, expectRedirect: false });

  await runClientInterceptTest('payment success navigation should redirect', (page) => page.evaluate(() => {
    history.replaceState({}, '', '/en/payment');
    window.__lotusCheckoutRedirected = false;
    history.pushState({}, '', '/en/payment/success');
    return { redirected: !!window.__lotusCheckoutRedirected };
  }), { path: '/en/payment', expectRedirect: true, skipSuccessCheck: true, skipOrderCheck: true });

} finally {
  await browser.close();
  serverProc.kill();
  await sleep(300);
}
