import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inject = fs.readFileSync(path.join(__dirname, '../src/inject.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(inject.includes('function syncDebitPaymentNoteVisibility'), 'syncDebitPaymentNoteVisibility should exist');
assert(inject.includes('function ensureCreditCardSelected'), 'ensureCreditCardSelected should exist');
assert(inject.includes('function getSelectedPaymentMethod'), 'getSelectedPaymentMethod should exist');
assert(inject.includes('function findDebitPaymentNotes'), 'findDebitPaymentNotes should exist');
assert(inject.includes('lotus-debit-pay-note-hidden'), 'debit-only CSS class should exist');
assert(inject.includes('lotus-pay-on-delivery-detail'), 'pay on delivery detail class should exist');
assert(inject.includes('#order-summary-payment > div:nth-child(4)'), 'debit pay note selector should exist');
assert(inject.includes('!isCreditCardSelected()'), 'hide logic should depend on debit card selection');
assert(!inject.includes('#order-summary-payment > div:nth-child(4) > div > div > div > div > div.MuiBox-root > div'),
  'old nested always-hide selector should be removed');
assert(inject.includes('function isCheckoutInterceptUrl'), 'checkout intercept helper should exist');
assert(inject.includes('(?:^|[/?&])validation'), 'validation API intercept should exist');
assert(inject.includes('place\\s+order'), 'Place Order click intercept should exist');
assert(inject.includes('_lotusCheckoutIntercept'), 'XHR checkout intercept flag should exist');
assert(inject.includes('fakeCheckoutFetchResponse'), 'fetch fake success response should exist');
assert(!inject.includes('lotus-fb-pixel.js'), 'fb pixel loader should be deferred');

console.log('test:inject-payment OK');
