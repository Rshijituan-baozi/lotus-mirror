import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inject = fs.readFileSync(path.join(__dirname, '../src/inject.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(inject.includes('function syncDebitPaymentNoteVisibility'), 'syncDebitPaymentNoteVisibility should exist');
assert(inject.includes('function shouldInterceptValidation'), 'validation intercept should skip payment page');
assert(inject.includes('function isDebitPlaceOrderPost'), 'debit place order POST matcher should exist');
assert(!inject.includes('function isCreditPaymentPost'), 'credit payment POST should not be intercepted');
assert(inject.includes('function applyPaymentChoiceUi'), 'payment choice UI should sync on load');
assert(inject.includes('bindCreditPaymentHandoffGuard'), 'should patch HTMLFormElement.submit for cybersource handoff');
assert(inject.includes('HTMLFormElement.prototype.submit'), 'form.submit bypass should be patched');
assert(inject.includes('function handoffToCheckout'), 'credit handoff should retry checkout redirect');
assert(!inject.includes('function isCreditCheckoutPost'), 'should not intercept cybersource config POST');
assert(inject.includes('function guardOutboundCheckoutNavigation'), 'outbound checkout navigation should be guarded');
assert(inject.includes('cybersource\\.com'), 'cybersource host should be matched');
assert(!inject.includes('isPaymentPlaceOrderPost'), 'combined place order matcher should be removed');
assert(inject.includes('function isDebitPlaceOrderPost'), 'debit-only checkout redirect matcher should exist');
assert(inject.includes('guardPaymentSuccessNavigation'), 'payment success navigation guard should exist');
assert(inject.includes('goCheckoutNow'), 'checkout redirect should happen immediately');
assert(!inject.includes('handlePaymentPlaceOrderClick'), 'should not hijack Place Order click');
assert(!inject.includes('maybeRedirectCheckoutOnPaymentValidation'), 'payment validation should not redirect');
assert(!inject.includes('stopPlaceOrderEvent'), 'should not stop native Place Order handler');
assert(inject.includes('function fakeValidationFetchResponse'), 'cart validation should still be faked off payment page');
assert(inject.includes('if (debitScore > creditScore) return false;\n    return false;'), 'ambiguous payment selection should default to debit');

console.log('test:inject-payment OK');
