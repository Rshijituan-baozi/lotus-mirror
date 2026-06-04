import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'fs';
import https from 'https';
import zlib from 'zlib';

const TARGET = 'https://www.lotuss.com.my';
const TARGET_ORIGIN = 'https://www.lotuss.com.my';
const targetHost = new URL(TARGET).host;

const CLIENT_INJECT = fs.readFileSync(new URL('./inject.js', import.meta.url), 'utf8')
  .replace(/<\/script/gi, '<\\/script');

const agent = new https.Agent({ keepAlive: false, maxSockets: 8 });

const MODEL_RE = /\.model\.json/i;

function rewriteToAbsolute(html, TARGET_ORIGIN) {
  // <link rel="stylesheet|icon" href="..."> → absolute
  html = html.replace(
    /(<link[^>]*rel=["'](?:stylesheet|icon|shortcut icon|apple-touch-icon)["'][^>]*href=")(\/[^"]*)"/gi,
    '$1' + TARGET_ORIGIN + '$2"'
  );
  // <script src="..."> → absolute
  html = html.replace(
    /(<script[^>]*src=")(\/[^"]*")/gi,
    '$1' + TARGET_ORIGIN + '$2'
  );
  // <img src="..."> → absolute
  html = html.replace(
    /(<img[^>]*src=")(\/[^"]*)"/gi,
    '$1' + TARGET_ORIGIN + '$2"'
  );
  // srcset → absolute
  html = html.replace(
    /(<(?:img|source)[^>]*srcset=")(\/[^"]*)"/gi,
    '$1' + TARGET_ORIGIN + '$2"'
  );
  // video poster → absolute
  html = html.replace(
    /(<video[^>]*poster=")(\/[^"]*)"/gi,
    '$1' + TARGET_ORIGIN + '$2"'
  );
  // inline CSS url() → absolute
  html = html.replace(
    /url\((["']?)(\/[^"')]+)\1\)/gi,
    'url($1' + TARGET_ORIGIN + '$2$1)'
  );
  return html;
}

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
    if (!obj['cq:cifHttpEndpoint']) obj['cq:cifHttpEndpoint'] = '/graphql';
    if (!obj['cq:cifStoreView']) obj['cq:cifStoreView'] = 'default';
    Object.keys(obj).forEach(k => walk(obj[k]));
  }
  walk(data);
}

export function createLotusProxy() {
  return createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    secure: false,
    agent,
    proxyTimeout: 30000,
    timeout: 30000,
    selfHandleResponse: true,
    headers: {
      Host: targetHost,
      origin: TARGET_ORIGIN,
      referer: TARGET_ORIGIN + '/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    },
    on: {
      proxyRes: (proxyRes, req, res) => {
        if (res.headersSent) { proxyRes.resume(); return; }
        const status = proxyRes.statusCode || 200;
        const ct = String(proxyRes.headers['content-type'] || '');
        const isHtml = ct.includes('text/html');
        // Model JSON: buffer + fix (goes through proxy)
        const isModel = MODEL_RE.test(req.url);

        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['x-frame-options'];

        // Redirects
        if (status >= 300 && status < 400 && proxyRes.headers['location']) {
          const h = {};
          Object.keys(proxyRes.headers).forEach(k => {
            if (k !== 'transfer-encoding' && k !== 'content-length') h[k] = proxyRes.headers[k];
          });
          h.location = proxyRes.headers['location'].replace(/https?:\/\/[^/]*lotuss\.com\.my/gi, '');
          res.writeHead(status, h);
          proxyRes.resume();
          res.end();
          return;
        }

        // Model JSON: buffer + fix (goes through proxy)
        const isModel = MODEL_RE.test(req.url);
        if (isModel && !isHtml) {
          const chunks = [];
          proxyRes.on('data', c => chunks.push(c));
          proxyRes.on('end', () => {
            if (res.headersSent) return;
            try {
              let body = Buffer.concat(chunks).toString('utf8');
              let data = JSON.parse(body);
              fixModelJson(data);
              body = Buffer.from(JSON.stringify(data), 'utf8');
              res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(body.length) });
              res.end(body);
            } catch { if (!res.headersSent) { res.writeHead(status, { 'content-type': ct }); res.end(Buffer.concat(chunks)); } }
          });
          proxyRes.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); });
          return;
        }

        // Non-HTML: pipe through (CSS/images/other JS from CDN shouldn't come here, but handle anyway)
        if (!isHtml) {
          const headers = {};
          Object.keys(proxyRes.headers).forEach(k => {
            if (k !== 'transfer-encoding') headers[k] = proxyRes.headers[k];
          });
          res.writeHead(status, headers);
          proxyRes.pipe(res);
          return;
        }

        // HTML: rewrite, inject, serve
        const htmlChunks = [];
        proxyRes.on('data', c => htmlChunks.push(c));
        proxyRes.on('end', () => {
          if (res.headersSent) return;
          let body = Buffer.concat(htmlChunks);
          const ce = proxyRes.headers['content-encoding'];
          if (ce) { try { body = ce.includes('br') ? zlib.brotliDecompressSync(body) : zlib.gunzipSync(body); } catch {} }
          let html = body.toString('utf8');

          // Rewrite resource URLs to absolute CDN (except CIF JS stays relative)
          html = rewriteToAbsolute(html, TARGET_ORIGIN);

          // Inject base href + client-side fix script
          html = html.replace(/<head[^>]*>/i, `<head><base href="/"><script>${CLIENT_INJECT}</script>`);

          // Strip tracking
          html = html.replace(/<script[^>]*googletagmanager[^>]*>[\s\S]*?<\/script>/gi, '');
          html = html.replace(/<script[^>]*helix-rum-js[^>]*>[\s\S]*?<\/script>/gi, '');
          html = html.replace(/<script[^>]*facebook[^>]*>[\s\S]*?<\/script>/gi, '');
          html = html.replace(/<link[^>]*manifest["'][^>]*>/gi, '');

          body = Buffer.from(html, 'utf8');
          res.writeHead(status, {
            'content-type': 'text/html; charset=utf-8',
            'content-length': String(body.length),
          });
          res.end(body);
        });
        proxyRes.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); });
      },
      error: (err, req, res) => {
        if (res.headersSent) return;
        res.writeHead(502); res.end('Proxy error');
      },
    },
  });
}
