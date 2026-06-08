import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function hasCheckedInput(el) {
  var input = el && el.querySelector('input[type="radio"], input[type="checkbox"]');
  return !!(input && input.checked);
}

function selectionScore(el) {
  if (!el) return 0;
  var score = 0;
  if (hasCheckedInput(el)) score += 100;
  if (/\b(Mui-selected|Mui-checked|selected|active)\b/i.test(el.className || '')) score += 80;
  if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true') score += 80;
  return score;
}

function getSelectedPaymentMethod(credit, debit, choice) {
  if (choice === 'creditCard') return 'creditCard';
  if (choice === 'debitCard') return 'debitCard';
  if (hasCheckedInput(credit)) return 'creditCard';
  if (hasCheckedInput(debit)) return 'debitCard';
  var creditScore = selectionScore(credit);
  var debitScore = selectionScore(debit);
  if (creditScore > debitScore) return 'creditCard';
  if (debitScore > creditScore) return 'debitCard';
  return 'creditCard';
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var credit = { className: '', getAttribute: () => null, querySelector: () => null };
var debitSelected = {
  className: 'Mui-selected',
  getAttribute: () => null,
  querySelector: () => ({ checked: false }),
};

assert(getSelectedPaymentMethod(credit, debitSelected, null) === 'debitCard', 'debit selected should win');
assert(getSelectedPaymentMethod(credit, debitSelected, 'debitCard') === 'debitCard', 'tracked debit choice should win while credit radio still checked');
assert(getSelectedPaymentMethod({ className: '', getAttribute: () => null, querySelector: () => ({ checked: true }) }, debitSelected, null) === 'creditCard', 'checked credit input should win when no tracked choice');
assert(getSelectedPaymentMethod({ className: '', getAttribute: () => null, querySelector: () => null }, { className: '', getAttribute: () => null, querySelector: () => null }, null) === 'creditCard', 'tie should default to credit');

const inject = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/inject.js'), 'utf8');
assert(inject.includes('syncPaymentSelectorTileIcons'), 'tile icon hiding should be scoped to selectors');
assert(!inject.includes('ensureCreditCardDefaultChoice'), 'should not force credit default on load');
assert(inject.includes('return false;'), 'ambiguous payment selection should default to debit');

console.log('test:payment-selection OK');
