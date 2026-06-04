import { createProxyMiddleware } from 'http-proxy-middleware';
import https from 'https';
import zlib from 'zlib';

const TARGET = 'https://www.lotuss.com.my';
const TARGET_ORIGIN = 'https://www.lotuss.com.my';
const targetHost = new URL(TARGET).host;

const agent = new https.Agent({ keepAlive: false, maxSockets: 8 });

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

        // Non-HTML: just pipe (shouldn't happen with base tag redirect, but handle it)
        if (!isHtml) {
          const headers = {};
          Object.keys(proxyRes.headers).forEach(k => {
            if (k !== 'transfer-encoding') headers[k] = proxyRes.headers[k];
          });
          res.writeHead(status, headers);
          proxyRes.pipe(res);
          return;
        }

        // HTML: rewrite resource URLs to absolute CDN, keep nav URLs relative
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
          if (res.headersSent) return;
          let body = Buffer.concat(chunks);
          const ce = proxyRes.headers['content-encoding'];
          if (ce) { try { body = ce.includes('br') ? zlib.brotliDecompressSync(body) : zlib.gunzipSync(body); } catch {} }
          let html = body.toString('utf8');

          // Rewrite CSS/JS/image resource URLs to absolute CDN
          // <link rel="stylesheet" href="...">  → absolute
          html = html.replace(
            /(<link[^>]*rel=["']stylesheet["'][^>]*href=")(\/[^"]*)"/gi,
            '$1' + TARGET_ORIGIN + '$2"'
          );
          // <link rel="icon" href="...">  → absolute
          html = html.replace(
            /(<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=")(\/[^"]*)"/gi,
            '$1' + TARGET_ORIGIN + '$2"'
          );
          // <script src="...">  → absolute
          html = html.replace(
            /(<script[^>]*src=")(\/[^"]*)"/gi,
            '$1' + TARGET_ORIGIN + '$2"'
          );
          // <img src="..."> and srcset="..."  → absolute
          html = html.replace(
            /(<img[^>]*src=")(\/[^"]*)"/gi,
            '$1' + TARGET_ORIGIN + '$2"'
          );
          html = html.replace(
            /(<img[^>]*srcset=")(\/[^"]*)"/gi,
            '$1' + TARGET_ORIGIN + '$2"'
          );
          // <source srcset="..." or <video poster="..."> → absolute
          html = html.replace(
            /((?:source|video)[^>]*(?:srcset|poster)=")(\/[^"]*)"/gi,
            '$1' + TARGET_ORIGIN + '$2"'
          );
          // CSS url(...) paths in inline <style> → absolute
          html = html.replace(
            /url\((["']?)(\/[^"')]+)\1\)/gi,
            'url($1' + TARGET_ORIGIN + '$2$1)'
          );

          // Inject base href for navigation to stay in proxy
          html = html.replace(/<head[^>]*>/i, '<head><base href="/">');

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
