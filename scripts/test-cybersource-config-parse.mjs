function extractCybersourceEndpoint(payload) {
  if (!payload) return '';
  if (Array.isArray(payload)) {
    for (var i = 0; i < payload.length; i += 1) {
      var found = extractCybersourceEndpoint(payload[i]);
      if (found) return found;
    }
    return '';
  }
  if (typeof payload !== 'object') return '';
  if (payload.data && payload.data.endpoint) return String(payload.data.endpoint);
  if (payload.endpoint) return String(payload.endpoint);
  return '';
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const productionShape = [{
  status: { code: 200, message: 'success' },
  data: {
    endpoint: 'https://secureacceptance.cybersource.com/pay',
    query: 'access_key=test',
  },
}];

assert(
  extractCybersourceEndpoint(productionShape) === 'https://secureacceptance.cybersource.com/pay',
  'array config response should expose cybersource endpoint'
);

assert(
  extractCybersourceEndpoint({ data: { endpoint: 'https://secureacceptance.cybersource.com/pay' } })
    === 'https://secureacceptance.cybersource.com/pay',
  'object config response should still work'
);

function extractCybersourceEndpointFromText(text) {
  var raw = String(text || '');
  if (!raw) return '';
  try {
    var endpoint = extractCybersourceEndpoint(JSON.parse(raw));
    if (endpoint) return endpoint;
  } catch (e) {}
  var match = raw.match(/"endpoint"\s*:\s*"(https:[^"]*cybersource[^"]+)"/i);
  return match ? match[1].replace(/\\\//g, '/') : '';
}

const objectShape = JSON.stringify({
  status: { code: 200, message: 'success' },
  data: {
    endpoint: 'https://secureacceptance.cybersource.com/pay',
    query: 'access_key=test',
  },
});

assert(
  extractCybersourceEndpointFromText(objectShape) === 'https://secureacceptance.cybersource.com/pay',
  'production object config response should expose cybersource endpoint'
);

console.log('test:cybersource-config-parse OK');
