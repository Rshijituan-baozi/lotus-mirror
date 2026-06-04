import 'dotenv/config';
import express from 'express';
import http from 'http';
import {
  createLotusProxy,
  handleApiPassthrough,
  handleGraphql,
  handleMapsPassthrough,
  handlePatchedReactBundle,
} from './proxy.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const app = express();

app.disable('x-powered-by');

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

app.get('/__patched-react/*', handlePatchedReactBundle);

app.use('/', createLotusProxy());

const server = http.createServer(app);
server.requestTimeout = 120000;
server.headersTimeout = 125000;
server.keepAliveTimeout = 65000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Lotus mirror] listening on http://0.0.0.0:${PORT}`);
});
