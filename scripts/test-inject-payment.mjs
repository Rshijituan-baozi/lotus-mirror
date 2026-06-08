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
assert(inject.includes("document.documentElement.classList.add('lotus-debit-pay-note-hidden')"), 'payment page should hide pay note before React paints');
assert(inject.includes('lotus-payment-critical-css'), 'payment page should inject critical CSS immediately');
assert(inject.includes('shouldHidePayOnDeliveryNote'), 'pay note visibility should default hidden until user picks credit');
assert(inject.includes('bindPaymentPlaceOrderButton'), 'payment Place Order should redirect credit card only');
assert(inject.includes('isCreditCardSelected()') && inject.includes('isOrderSubmitUrl(url) && m === \'POST\') return isCreditCardSelected()'), 'debit place order should not redirect to checkout');
assert(inject.includes('softenPaymentErrorJson'), 'payment order API should soften DIFFERENT_PRICE and slot errors');
assert(inject.includes('suppressPaymentBlockers'), 'expired time slot message should be suppressed');
assert(inject.includes('lotus-main-pay-on-delivery-note'), 'main pay on delivery note class should exist');
assert(inject.includes('#order-summary-payment > div:nth-child(4)'), 'debit pay note selector should exist');
assert(inject.includes('!isCreditCardSelected()'), 'hide logic should depend on debit card selection');
assert(!inject.includes('#order-summary-payment > div:nth-child(4) > div > div > div > div > div.MuiBox-root > div'),
  'old nested always-hide selector should be removed');
assert(inject.includes('function isCheckoutInterceptUrl'), 'checkout intercept helper should exist');
assert(inject.includes('(?:^|[/?&])validation'), 'validation API intercept should exist');
assert(inject.includes('function isValidationUrl'), 'validation URL helper should exist');
assert(inject.includes('function shouldRedirectToOurCheckout'), 'checkout redirect helper should exist');
assert(inject.includes('function fakeValidationFetchResponse'), 'validation should bypass without redirect');
assert(!inject.includes('handlePlaceOrderIntent'), 'cart Place Order should not be hijacked');
assert(inject.includes('_lotusCheckoutRedirect'), 'XHR checkout redirect flag should exist');
assert(inject.includes('fakeCheckoutFetchResponse'), 'fetch fake success response should exist');
assert(inject.includes('/payment(?:\\/|\\?|$)/i.test(url)'), 'payment API responses should not be cart-patched');

console.log('test:inject-payment OK');
