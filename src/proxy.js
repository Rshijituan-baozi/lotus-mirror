import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs';
import https from 'https';
import zlib from 'zlib';

const TARGET = 'https://www.lotuss.com.my';
const TARGET_ORIGIN = 'https://www.lotuss.com.my';
const targetHost = new URL(TARGET).host;

const LOTUS_DOMAIN_RE = /https?:\/\/(?:www\.|shoponline\.|mcprod\.)?lotuss\.com\.my/gi;
const LOTUS_HOST_RE = /^(?:www\.|shoponline\.|mcprod\.)?lotuss\.com\.my$/i;
const CLIENT_INJECT_SCRIPT = fs.readFileSync(new URL('./inject.js', import.meta.url), 'utf8')
  .replace(/<\/script/gi, '<\\/script');

// Headers forbidden in HTTP/2 (RFC 7540 §8.1.2.2). If forwarded to an HTTP/2
// frontend (Cloudflare / nginx), browsers abort with ERR_HTTP2_PROTOCOL_ERROR.
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
function sanitizeResponseHeaders(headers) {
  const h = { ...headers };
  for (const k of Object.keys(h)) {
    if (HOP_BY_HOP.includes(k.toLowerCase())) delete h[k];
  }
  return h;
}

function rewriteLotusLocation(location) {
  const value = String(location || '');
  try {
    const url = new URL(value, TARGET_ORIGIN);
    if (LOTUS_HOST_RE.test(url.host)) {
      return `${url.pathname}${url.search}${url.hash}` || '/';
    }
  } catch {}
  return value
    .replace(LOTUS_DOMAIN_RE, '')
    .replace(/^\/\/(?:www\.|shoponline\.|mcprod\.)?lotuss\.com\.my/i, '')
    .replace(/^\/\//, '/');
}

const MAX_SOCKETS = parseInt(process.env.MAX_SOCKETS || '24');
const agent = new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS });

// Throttling: serializes upstream requests. A large global gap starves the SPA's
// data fetches and makes the app time out and redirect to /errors/500, so default to off.
let lastReqTime = 0;
const MIN_GAP = parseInt(process.env.MIN_GAP || '0');
const STATIC_RE = /\.(js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|avif|map)(\?|$)/i;
function throttle() {
  if (MIN_GAP <= 0) return Promise.resolve();
  const now = Date.now();
  const wait = Math.max(0, MIN_GAP - (now - lastReqTime));
  lastReqTime = now + wait;
  return new Promise(r => setTimeout(r, wait));
}

const cache = new Map();
const CACHE_MAX = 3000;
const STATIC_TTL = 30 * 60 * 1000;
const HTML_TTL = 3 * 60 * 1000;
function cacheGet(key) { const e = cache.get(key); return e && Date.now() - e.ts < HTML_TTL ? e.data : null; }
function cacheGetStatic(key) { const e = cache.get(key); return e && Date.now() - e.ts < STATIC_TTL ? e.data : null; }
function cacheSet(key, data) { if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); cache.set(key, { data, ts: Date.now() }); }

function fixModelJson(data) {
  if (!data || typeof data !== 'object') return;
  if (data.title === '404' || (data[':path'] && data[':path'].indexOf('errors') !== -1)) {
    data.title = "Lotus's Shop Online";
    data[':path'] = '/en/home';
  }
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (obj.endpoint && typeof obj.endpoint === 'string') {
      obj.endpoint = obj.endpoint.replace(/https?:\/\/mcprod\.lotuss\.com\.my\/graphql/gi, '/graphql')
        .replace(/https?:\/\/mcprod\.lotuss\.com\.my/gi, '');
    }
    // Inject commerce config at every node
    if (!obj['cq:cifHttpEndpoint']) obj['cq:cifHttpEndpoint'] = '/graphql';
    if (!obj['cq:cifStoreView']) obj['cq:cifStoreView'] = 'default';
    Object.keys(obj).forEach(k => walk(obj[k]));
  }
  walk(data);
}

// Magento GraphQL proxy
const magentoAgent = new https.Agent({ keepAlive: true });
export function handleGraphql(req, res) {
  if (res.headersSent) return;
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    // Preserve the query string (Magento APQ / GET persisted queries depend on it).
    const qsIndex = req.url.indexOf('?');
    const path = '/graphql' + (qsIndex >= 0 ? req.url.slice(qsIndex) : '');
    const fwdHeaders = {
      'Host': 'mcprod.lotuss.com.my',
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Store': req.headers['store'] || 'default',
      'Accept': req.headers['accept'] || 'application/json',
    };
    // Pass through headers the storefront uses for cart/customer/currency context.
    for (const k of ['authorization', 'content-currency', 'cookie', 'preview-version', 'x-magento-cache-id']) {
      if (req.headers[k]) fwdHeaders[k] = req.headers[k];
    }
    const r = https.request({
      hostname: 'mcprod.lotuss.com.my', port: 443, path,
      method: req.method, agent: magentoAgent,
      headers: fwdHeaders
    }, pRes => {
      const h = sanitizeResponseHeaders(pRes.headers);
      h['access-control-allow-origin'] = '*';
      delete h['www-authenticate'];
      res.writeHead(pRes.statusCode, h);
      pRes.pipe(res);
    });
    r.on('error', e => { if (!res.headersSent) { res.writeHead(502); res.end('{"error":"upstream"}'); } });
    if (body) r.write(body);
    r.end();
  });
}

// Backend API hosts the storefront calls directly from the browser. Calling them
// cross-origin fails CORS (Network Error) and makes the app redirect to /errors/500,
// so we expose them same-origin under /__api/<host>/... and forward server-side.
export const API_HOSTS = new Set([
  'api-o2o.lotuss.com.my',
  'api-customer.lotuss.com.my',
  'shoponline-bffapi.lotuss.com.my',
]);
const apiAgent = new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS });

export function handleApiPassthrough(req, res) {
  if (res.headersSent) return;
  // req.url here is "/<host>/<rest>?<qs>" (mounted at /__api)
  const m = req.url.match(/^\/([^/]+)(\/[^?]*)?(\?.*)?$/);
  if (!m) { res.writeHead(400); res.end('bad api path'); return; }
  const host = m[1];
  if (!API_HOSTS.has(host)) { res.writeHead(403); res.end('host not allowed'); return; }
  const path = (m[2] || '/') + (m[3] || '');

  // Forward every client header (the storefront sets auth headers like `key`,
  // `version`, `channel`, `guest-id`, `x-request-id` that the BFF requires),
  // only overriding host/origin/referer and dropping hop-by-hop headers.
  const HOP = new Set(['host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length']);
  const fwdHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP.has(k.toLowerCase())) fwdHeaders[k] = v;
  }
  fwdHeaders['Host'] = host;
  fwdHeaders['Origin'] = 'https://' + host;
  fwdHeaders['Referer'] = 'https://' + host + '/';
  if (!fwdHeaders['accept'] && !fwdHeaders['Accept']) fwdHeaders['Accept'] = 'application/json';

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (body.length) fwdHeaders['Content-Length'] = String(body.length);
    const r = https.request({ hostname: host, port: 443, path, method: req.method, agent: apiAgent, headers: fwdHeaders }, pRes => {
      const h = sanitizeResponseHeaders(pRes.headers);
      h['access-control-allow-origin'] = '*';
      h['access-control-allow-credentials'] = 'true';
      delete h['content-security-policy'];
      delete h['x-frame-options'];
      res.writeHead(pRes.statusCode || 502, h);
      pRes.pipe(res);
    });
    r.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('{"error":"upstream"}'); } });
    if (body.length) r.write(body);
    r.end();
  });
}

export function createLotusProxy() {
  const throttleMw = (req, res, next) => {
    if (MIN_GAP <= 0 || STATIC_RE.test(req.url)) { next(); return; }
    throttle().then(next).catch(() => {
      if (!res.headersSent) { res.writeHead(503); res.end('Busy'); }
    });
  };

  const proxy = createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    secure: false,
    agent,
    proxyTimeout: 120000,
    timeout: 120000,
    selfHandleResponse: true,
    headers: {
      Host: targetHost,
      origin: TARGET_ORIGIN,
      referer: TARGET_ORIGIN + '/',
      'accept-encoding': 'identity',
    },
    on: {
      proxyRes: (proxyRes, req, res) => {
        if (res.headersSent) { proxyRes.resume(); return; }
        const status = proxyRes.statusCode || 200;
        const ct = String(proxyRes.headers['content-type'] || '');

        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['x-content-type-options'];

        // Rate limit → serve from cache
        if (status === 403 || status === 429 || status >= 500) {
          const ck = req.method + ':' + req.url;
          const cached = cacheGet(ck) || cacheGetStatic(ck);
          if (cached) { res.writeHead(200, { 'content-type': ct.includes('html') ? 'text/html' : ct + '; charset=utf-8' }); res.end(cached.data); proxyRes.resume(); return; }
          if (!res.headersSent) { res.writeHead(503); res.end('Temporarily unavailable'); proxyRes.resume(); }
          return;
        }

        // Redirects
        if (status >= 300 && status < 400 && proxyRes.headers['location']) {
          const h = {};
          Object.keys(proxyRes.headers).forEach(k => {
            if (!['transfer-encoding', 'content-length', 'content-encoding'].includes(k)) h[k] = proxyRes.headers[k];
          });
          h.location = rewriteLotusLocation(proxyRes.headers['location']);
          res.writeHead(status, h);
          proxyRes.resume();
          res.end();
          return;
        }

        // JSON → fix model
        if (ct.includes('json')) {
          const chunks = [];
          proxyRes.on('data', c => chunks.push(c));
          proxyRes.on('end', () => {
            if (res.headersSent) return;
            try {
              let body = Buffer.concat(chunks).toString('utf8');
              let data = JSON.parse(body);
              fixModelJson(data);
              body = Buffer.from(JSON.stringify(data), 'utf8');
              res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'content-length': String(body.length) });
              res.end(body);
            } catch { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(Buffer.concat(chunks)); } }
          });
          return;
        }

        // Non-HTML
        if (!ct.includes('text/html')) {
          const ck = req.method + ':' + req.url;
          const isJs = ct.includes('javascript') || /\.js(\?|$)/i.test(req.url);
          const isStatic = isJs || /\.(css|woff2?|ttf|png|jpe?g|gif|svg|ico|webp)(\?|$)/i.test(req.url);

          if (req.method === 'GET' && isStatic) {
            // For large non-JS files, stream without buffering
            const needsBuffer = isJs;
            if (!needsBuffer) {
              const cached = cacheGetStatic(ck);
              if (cached) { res.writeHead(200, { 'content-type': ct, 'content-length': String(cached.length) }); res.end(cached); proxyRes.resume(); return; }
              // Stream directly to browser, tee to cache
              const teeChunks = [];
              proxyRes.on('data', c => { teeChunks.push(c); res.write(c); });
              proxyRes.on('end', () => {
                if (!res.headersSent) return;
                try { cacheSet(ck, Buffer.concat(teeChunks)); } catch {}
                res.end();
              });
              proxyRes.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); });
              const shdr = { 'content-type': ct, 'access-control-allow-origin': '*' };
              if (proxyRes.headers['content-encoding']) shdr['content-encoding'] = proxyRes.headers['content-encoding'];
              res.writeHead(status, shdr);
              return;
            }

            // JS files: buffer for CIF patching
            const cached = cacheGetStatic(ck);
            if (cached) { res.writeHead(200, { 'content-type': ct, 'content-length': String(cached.length) }); res.end(cached); proxyRes.resume(); return; }
            const ce = proxyRes.headers['content-encoding'];
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
              if (res.headersSent) return;
              let b = Buffer.concat(chunks);
              // Cheap Buffer scan first; only stringify (expensive on multi-MB
              // bundles) when the CIF marker is actually present and uncompressed.
              if (!ce && b.indexOf('commerce API') !== -1) {
                let js = b.toString('utf8');
                js = js.replace(
                  /!(\w+)\s*\|\|\s*!\1\.graphqlEndpoint\s*\)\s*throw\s+(?:new\s+)?Error\s*\(\s*"The\s+commerce\s+API[^"]*"\)\s*;/gi,
                  '$1=$1||{},$1.graphqlEndpoint=$1.graphqlEndpoint||"/graphql",$1.storeView=$1.storeView||"default",0){};'
                );
                b = Buffer.from(js, 'utf8');
              }
              cacheSet(ck, b);
              const hdr = { 'content-type': ct, 'content-length': String(b.length), 'access-control-allow-origin': '*' };
              if (ce) hdr['content-encoding'] = ce;
              res.writeHead(status, hdr);
              res.end(b);
            });
            proxyRes.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); });
            return;
          }
          const h = sanitizeResponseHeaders(proxyRes.headers);
          res.writeHead(status, h);
          proxyRes.pipe(res);
          return;
        }

        // HTML
        const ck = req.method + ':' + req.url;
        if (req.method === 'GET') {
          const cached = cacheGet(ck);
          if (cached) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(cached.length) }); res.end(cached); proxyRes.resume(); return; }
        }
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
          if (res.headersSent) return;
          try {
            let body = Buffer.concat(chunks);
            const ce = proxyRes.headers['content-encoding'];
            if (ce) { try { body = ce.includes('br') ? zlib.brotliDecompressSync(body) : zlib.gunzipSync(body); } catch {} }
            let html = body.toString('utf8');

            // Strip lotus domains, inject base and client-side proxy fixes
            html = html.replace(LOTUS_DOMAIN_RE, '');
            const headPatch = `<base href="/"><script>${CLIENT_INJECT_SCRIPT}</script>`;
            // Use a replacement function so `$1`/`$&` inside the injected script
            // are treated literally instead of as regex backreferences.
            if (/<head[^>]*>/i.test(html)) {
              html = html.replace(/<head([^>]*)>/i, (m) => `${m}${headPatch}`);
            } else {
              html = headPatch + html;
            }

            // Strip tracking
            html = html.replace(/<script[^>]*googletagmanager[^>]*>[\s\S]*?<\/script>/gi, '');
            html = html.replace(/<script[^>]*helix-rum-js[^>]*>[\s\S]*?<\/script>/gi, '');
            html = html.replace(/<script[^>]*facebook[^>]*>[\s\S]*?<\/script>/gi, '');
            html = html.replace(/<link[^>]*manifest["'][^>]*>/gi, '');

            body = Buffer.from(html, 'utf8');
            if (req.method === 'GET') cacheSet(ck, body);
            res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(body.length) });
            res.end(body);
          } catch { if (!res.headersSent) res.writeHead(502).end(); }
        });
        proxyRes.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); });
      },
      error: (err, req, res) => {
        if (res.headersSent) return;
        const ck = req.method + ':' + req.url;
        const cached = cacheGet(ck) || cacheGetStatic(ck);
        if (cached) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(cached); return; }
        res.writeHead(503); res.end('Temporarily unavailable');
      },
    },
  });

  return [throttleMw, proxy];
}
