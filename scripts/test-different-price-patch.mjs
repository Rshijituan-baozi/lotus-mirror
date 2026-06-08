import {
  patchDifferentPriceBody,
  isCartValidationRequest,
  CHECKOUT_VALIDATION_OK_BODY,
} from '../src/proxy.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const errBody = Buffer.from(JSON.stringify({
  error: { code: 40001, type: 'DIFFERENT_PRICE', description: 'mismatch' },
}), 'utf8');

const ok = patchDifferentPriceBody(errBody);
assert(ok.status === 200, 'DIFFERENT_PRICE should be rewritten to 200');
assert(ok.body.toString('utf8') === CHECKOUT_VALIDATION_OK_BODY, 'body should be validation ok payload');

assert(isCartValidationRequest('/__api/shoponline-bffapi.lotuss.com.my/v1/cart/validation?websiteCode=malaysia_hy&totalPrice=65.2'), 'cart validation url should match');
assert(!isCartValidationRequest('/en/product/foo'), 'product page should not match');

console.log('test:different-price-patch OK');
