import assert from 'assert';
import {
  isCybersourceConfigRequest,
  rewriteCybersourceConfigBody,
} from '../src/proxy.js';

function assertEndpoint(body, url, expected) {
  const out = rewriteCybersourceConfigBody(Buffer.from(body, 'utf8'), url);
  assert(out, `expected rewrite for ${url}`);
  const json = JSON.parse(out.toString('utf8'));
  const endpoint = Array.isArray(json)
    ? json[0]?.data?.endpoint
    : json?.data?.endpoint;
  assert.strictEqual(endpoint, expected);
}

const configUrl = '/__api/shoponline-bffapi.lotuss.com.my/v1/payment/cybersource/config?websiteCode=malaysia_hy';

assert(isCybersourceConfigRequest(configUrl), 'config url should match');
assert(!isCybersourceConfigRequest('/__api/shoponline-bffapi.lotuss.com.my/v1/cart/items'), 'cart url should not match');

assertEndpoint(JSON.stringify({
  status: { code: 200, message: 'success' },
  data: {
    endpoint: 'https://secureacceptance.cybersource.com/pay',
    query: 'access_key=test',
  },
}), configUrl, '/checkout/');

assertEndpoint(JSON.stringify([{
  status: { code: 200, message: 'success' },
  data: {
    endpoint: 'https://secureacceptance.cybersource.com/pay',
    query: 'access_key=test',
  },
}]), configUrl, '/checkout/');

console.log('test:proxy-cybersource-config-rewrite OK');
