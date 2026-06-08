import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const inject = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/inject.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(inject.includes('syncPaymentSelectorIcons'), 'payment icon sync helper should exist');
assert(inject.includes('isCreditCardSelected()') && inject.includes('removeProperty(\'display\')'), 'debit mode should restore payment icons');
assert(!inject.includes("hideAll('#icon-payment-2, #icon-payment-3')"), 'should not always hide payment icons globally');

console.log('test:payment-debit-icons OK');
