import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inject = fs.readFileSync(path.join(__dirname, '../src/inject.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const samples = [
  'validation?websiteCode=malaysia_hy&totalPrice=65.2',
  '/__api/shoponline-bffapi.lotuss.com.my/v1/cart/validation?websiteCode=malaysia_hy',
  'https://shoponline-bffapi.lotuss.com.my/cart/validation?websiteCode=malaysia_hy',
  '/cybersource/config',
];

assert(inject.includes('isValidationUrl'), 'validation URL matcher should allow relative paths');
assert(inject.includes('shouldRedirectToOurCheckout'), 'cybersource redirect helper should exist');
assert(inject.includes('fakeValidationFetchResponse'), 'validation bypass should not redirect');
assert(inject.includes('fakeCheckoutFetchResponse'), 'checkout redirect fetch helper should exist');
assert(inject.includes('completeValidationSuccessXhr'), 'XHR validation success helper should exist');
assert(!inject.includes('handlePlaceOrderIntent'), 'cart Place Order should not be hijacked');
assert(inject.includes('location.replace'), 'redirect should use location.replace');

const fnBlock = inject.slice(
  inject.indexOf('function isValidationUrl'),
  inject.indexOf('var lotusCheckoutRedirecting')
);
assert(inject.includes('normalizeHttpMethod'), 'HTTP method helper should exist');
assert(inject.includes('isOrderSubmitUrl'), 'order submit URL matcher should exist');
assert(inject.includes('isCybersourceConfigUrl'), 'cybersource config matcher should exist');
assert(!inject.includes('set[_-]?payment'), 'setPayment should not trigger checkout redirect');
assert(!inject.includes('/__api/') || !fnBlock.includes('/payment(?:[/?]|$)/i.test(u)'), 'payment page GET APIs should not auto redirect');

console.log('test:place-order-intercept OK');
console.log('sample URLs covered:', samples.join(' | '));
