import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const inject = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/inject.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(inject.includes('syncPaymentSelectorTileIcons'), 'tile icon helper should exist');
assert(inject.includes('#payment-section-payOnDelivery > span #icon-payment-2'), 'tile icons should be scoped');
assert(!inject.includes('syncPaymentSelectorIcons'), 'global icon toggling should be removed');
assert(inject.includes('tagDebitPaymentNotes'), 'pay on delivery notes should be tagged for CSS hiding');
assert(!inject.includes('if (hide) note.style.setProperty'), 'inline pay note hiding should be removed');

console.log('test:payment-debit-icons OK');
