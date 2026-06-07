import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inject = fs.readFileSync(path.join(__dirname, '../src/inject.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(inject.includes('function syncDebitPaymentNoteVisibility'), 'syncDebitPaymentNoteVisibility should exist');
assert(inject.includes('lotus-debit-pay-note-hidden'), 'debit-only CSS class should exist');
assert(inject.includes('#order-summary-payment > div:nth-child(4)'), 'debit pay note selector should exist');
assert(inject.includes('!isCreditCardSelected()'), 'hide logic should depend on debit card selection');
assert(!inject.includes('#order-summary-payment > div:nth-child(4) > div > div > div > div > div.MuiBox-root > div'),
  'old nested always-hide selector should be removed');

console.log('test:inject-payment OK');
