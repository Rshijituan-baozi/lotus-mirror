import 'dotenv/config';
import express from 'express';
import http from 'http';
import { createLotusProxy } from './proxy.js';

const PORT = parseInt(process.env.PORT || '3000');
const app = express();

app.use('/', createLotusProxy());

const server = http.createServer(app);
server.timeout = 0;
server.listen(PORT, '0.0.0.0', () => console.log(`[Lotus] http://localhost:${PORT}`));
