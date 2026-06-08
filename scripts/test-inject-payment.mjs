import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inject = fs.readFileSync(path.join(__dirname, '../src/inject.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(inject.includes('function syncDebitPaymentNoteVisibility'), 'syncDebitPaymentNoteVisibility should exist');
assert(inject.includes('function syncPaymentSelectorTileIcons'), 'tile icon hiding should be scoped to selectors');
assert(inject.includes('function isCreditCardSelected'), 'isCreditCardSelected should exist');
assert(inject.includes('function syncPaymentChoiceFromDom'), 'should sync payment choice from DOM on load');
assert(!inject.includes('function getSelectedPaymentMethod'), 'getSelectedPaymentMethod should not duplicate selection logic');
assert(!inject.includes('ensureCreditCardDefaultChoice'), 'should not force credit card default on load');
assert(inject.includes('applyCreditDiscountState'), 'discount state should update immediately on click');
assert(inject.includes('paymentSectionsReady'), 'payment patch should wait for payment sections');
assert(inject.includes('lotus-main-pay-on-delivery-note'), 'main pay note should use dedicated class');
assert(inject.includes('findMainPayOnDeliveryNote'), 'main pay note should use smallest matching block');
assert(!inject.includes('lotus-pay-on-delivery-detail{display:none'), 'broad pay note class rule should be removed');
assert(inject.includes('tagMainPayOnDeliveryNote'), 'main pay note tagging should be scoped');
assert(!inject.includes('syncPaymentSelectorIcons'), 'global payment icon toggling should be removed');
assert(inject.includes('function findDebitPaymentNotes'), 'findDebitPaymentNotes should exist');
assert(inject.includes('lotus-debit-pay-note-hidden'), 'debit-only CSS class should exist');
assert(!/if \(\/\/payment[\s\S]{0,200}classList\.add\('lotus-debit-pay-note-hidden'\)/.test(inject), 'payment page should not force debit hidden on first paint');
assert(inject.includes('lotus-payment-critical-css'), 'payment page should inject critical CSS immediately');
assert(inject.includes('shouldHidePayOnDeliveryNote'), 'pay note visibility should follow credit/debit selection');
assert(inject.includes('maybeRedirectCheckoutOnPaymentValidation'), 'payment validation should redirect to checkout');
assert(inject.includes('isPaymentSuccessUrl'), 'payment success page should redirect to checkout');
assert(inject.includes('guardPaymentSuccessNavigation'), 'payment success navigation guard should exist');
assert(inject.includes('isPaymentPlaceOrderPost'), 'payment page order POST matcher should exist');
assert(inject.includes('goCheckoutNow'), 'checkout redirect should happen immediately');
assert(!inject.includes('handlePaymentPlaceOrderClick'), 'should not hijack Place Order click');
assert(!inject.includes('bindPaymentPlaceOrderButton'), 'should not bind Place Order click listeners');
assert(inject.includes('function isCreditPaymentPost'), 'credit payment POST matcher should exist');
assert(inject.includes('function isDebitPlaceOrderPost'), 'debit place order POST matcher should exist');
assert(inject.includes('/payment(?:\\/|\\?|$)/i.test(u)'), 'credit payment POST should match /payment URLs');
assert(inject.includes('syncNativePaymentInput'), 'payment choice should sync native radio input');
assert(inject.includes('pointer-events:none'), 'pay-on-delivery notes should not block Place Order clicks');
assert(!inject.includes('scanPlaceOrderButtons'), 'should not double-bind Place Order buttons');
assert(!inject.includes('bindPlaceOrderNode'), 'should not bind per-node pointerdown handlers');
assert(!inject.includes('__lotusPlaceOrderRedirecting'), 'should not use sticky Place Order redirect flag');
assert(!inject.includes('stopPlaceOrderEvent'), 'should not stop native Place Order handler');
assert(inject.includes('Location.prototype, \'href\''), 'location.href should guard payment success');
assert(!inject.includes('isOrderSubmitUrl(url) && m === \'POST\') return isCreditCardSelected()'), 'debit place order should also redirect to checkout');
assert(inject.includes('softenDifferentPriceJson'), 'payment order API should soften DIFFERENT_PRICE');
assert(!inject.includes('suppressPaymentBlockers'), 'time slot expired message should remain visible');
assert(!inject.includes('isDeliverySlotUrl'), 'delivery slot API should not be bypassed');
assert(inject.includes('#order-summary-payment > div:nth-child(4)'), 'debit pay note selector should exist');
assert(inject.includes('!isCreditCardSelected()'), 'hide logic should depend on debit card selection');
assert(inject.includes('function isCheckoutInterceptUrl'), 'checkout intercept helper should exist');
assert(inject.includes('function isValidationUrl'), 'validation URL helper should exist');
assert(inject.includes('function shouldRedirectToOurCheckout'), 'checkout redirect helper should exist');
assert(inject.includes('function fakeValidationFetchResponse'), 'validation should be faked on payment page');
assert(!inject.includes('handlePlaceOrderIntent'), 'cart Place Order should not be hijacked');
assert(inject.includes('_lotusCheckoutRedirect'), 'XHR checkout redirect flag should exist');
assert(inject.includes('fakeCheckoutFetchResponse'), 'fetch fake success response should exist');
assert(inject.includes('if (debitScore > creditScore) return false;\n    return true;'), 'ambiguous payment selection should default to credit');

console.log('test:inject-payment OK');
