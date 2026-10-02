import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import type { Database } from '../../shared/database.js';
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from '../../shared/types.js';
import { openDatabase } from './db/index.js';
import { createApiRouter } from './routes/index.js';
import { initializeRealtime } from './realtime/index.js';
export function createStudyRoomServer(options: { database: Database; clientDist?: string }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', stage: 'scaffold' }));
  const dependencies = { database: options.database, sessions: options.database };
  app.use('/api', createApiRouter(dependencies));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  const clientDist = options.clientDist;
  if (clientDist && existsSync(resolve(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
  }
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && error.status === 400 ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'Invalid JSON body.' : 'Internal server error.' });
  });
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer);
  initializeRealtime(io, dependencies);
  return { app, httpServer, io };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const database = openDatabase(process.env.DATABASE_PATH || './data/study-room.sqlite');
  const { httpServer, io } = createStudyRoomServer({ database, clientDist: resolve('dist/client') });
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  httpServer.listen(port, host, () => console.log(`Study Room scaffold listening on http://${host}:${port}`));
  const shutdown = () => { io.close(() => { database.close(); process.exit(0); }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
