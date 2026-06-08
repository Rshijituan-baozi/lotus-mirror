import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createLotusProxy,
  handleApiPassthrough,
  handleGraphql,
  handleMapsPassthrough,
  isCartValidationRequest,
  CHECKOUT_VALIDATION_OK_BODY,
} from './proxy.js';
import { createAdminProductOverridesRouter } from './admin-product-overrides.js';
import { getPublicSettings } from './fb-pixels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const app = express();

app.disable('x-powered-by');

app.use((req, res, next) => {
  const target = req.originalUrl || req.url || '';
  if (!isCartValidationRequest(target)) return next();
  res.set({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-credentials': 'true',
  });
  res.status(200).send(CHECKOUT_VALIDATION_OK_BODY);
});

const bootstrapJson = {
  'cq:cifHttpEndpoint': '/graphql',
  'cq:cifStoreView': 'default',
};

app.get('/libs/granite/csrf/token.json', (req, res) => {
  res.set({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    'access-control-allow-origin': '*',
  });
  res.send(bootstrapJson);
});

app.get(/^\/[^/]+\/api\/maintenance$/, (req, res) => {
  res.set({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    'access-control-allow-origin': '*',
  });
  res.send({
    runmode: true,
    maintenancePath: '/content/aem-cplotusonlinecommerce-project/my/en/maintenance',
    start: '2023-11-21T22:00:00.000+07:00',
    end: '2023-11-22T03:00:00.000+07:00',
    maintenanceMode: false,
    rootPath: '/content/aem-cplotusonlinecommerce-project/my',
    ...bootstrapJson,
  });
});

app.options('/graphql', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.sendStatus(204);
});
app.use('/graphql', handleGraphql);

app.options('/__api/*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(204);
});
app.use('/__api', handleApiPassthrough);

app.use('/__maps', handleMapsPassthrough);

app.use('/product-overrides', express.static(path.join(__dirname, '..', 'public', 'product-overrides')));
app.use('/js', express.static(path.join(__dirname, '..', 'public', 'js')));
app.use(createAdminProductOverridesRouter());

app.get('/api/settings', async (req, res) => {
  res.set({
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  const upstream = (process.env.SOYBEAN_API_BASE || process.env.ADMIN_API_BASE || '').replace(/\/$/, '');
  if (upstream) {
    for (const path of ['/api/settings', '/settings']) {
      try {
        const r = await fetch(`${upstream}${path}`, {
          headers: { accept: 'application/json' },
        });
        if (!r.ok) continue;
        const text = await r.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          continue;
        }
        const fbPixels = json && json.data && json.data.fbPixels;
        if (!Array.isArray(fbPixels)) continue;
        res.set('content-type', 'application/json; charset=utf-8');
        res.send(text);
        return;
      } catch (e) {
        console.warn(`[Lotus mirror] /api/settings upstream ${path} failed:`, e.message);
      }
    }
  }
  res.set('content-type', 'application/json; charset=utf-8');
  res.json({ data: getPublicSettings() });
});

// Static pages
app.use('/checkout', express.static(path.join(__dirname, '..', 'public', 'checkout')));
app.use('/pay', express.static(path.join(__dirname, '..', 'public', 'pay')));
app.use('/complete', express.static(path.join(__dirname, '..', 'public', 'complete')));

app.use((req, res, next) => {
  const target = req.originalUrl || req.url || '';
  const pathOnly = target.split('?')[0].split('#')[0];
  if (/\/payment\/success(?:\/|$)/i.test(pathOnly)) {
    res.redirect(302, '/checkout/');
    return;
  }
  const referer = String(req.headers.referer || req.headers.referrer || '');
  const fromPayment = /\/payment(?:\/|\?|$)/i.test(referer);
  if (fromPayment && req.method === 'POST' && /(?:^|\/)pay(?:\/|$)/i.test(pathOnly)) {
    res.redirect(302, '/checkout/');
    return;
  }
  next();
});

app.use('/', createLotusProxy());

const server = http.createServer(app);
server.requestTimeout = 120000;
server.headersTimeout = 125000;
server.keepAliveTimeout = 65000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Lotus mirror] listening on http://0.0.0.0:${PORT}`);
});
