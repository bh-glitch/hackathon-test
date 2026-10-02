import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import Sqlite from 'better-sqlite3';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';
import { createStudyRoomServer } from '../server/src/index.js';
import { openDatabase } from '../server/src/db/index.js';

test('SQLite native dependency opens an independent in-memory database', () => {
  const sqlite = new Sqlite(':memory:');
  try { assert.deepEqual(sqlite.prepare('SELECT 1 AS ready').get(), { ready: 1 }); }
  finally { sqlite.close(); }
});

test('HTTP routing, SPA fallback and Socket.IO transport are wired together', { timeout: 10_000 }, async () => {
  const clientDist = await mkdtemp(join(tmpdir(), 'study-room-'));
  const html = '<!doctype html><title>Scaffold fixture</title>';
  await writeFile(join(clientDist, 'index.html'), html);
  const database = openDatabase(':memory:');
  const { httpServer, io } = createStudyRoomServer({ database, clientDist });
  let socket: Socket<ServerToClientEvents, ClientToServerEvents> | undefined;
  try {
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const address = httpServer.address();
    assert(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', stage: 'scaffold' });
    assert.equal(await (await fetch(`${origin}/room/example`)).text(), html);
    assert.equal((await fetch(`${origin}/api/missing`)).status, 404);
    assert.equal((await fetch(`${origin}/api/session`, { method: 'POST' })).status, 501);
    assert.equal((await fetch(`${origin}/api/rooms`, { method: 'POST' })).status, 501);
    assert.equal((await fetch(`${origin}/api/rooms/example`)).status, 501);
    const invalidJson = await fetch(`${origin}/api/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(invalidJson.status, 400);
    assert.deepEqual(await invalidJson.json(), { error: 'Invalid JSON body.' });
    socket = connect(origin, { autoConnect: false, reconnection: false });
    const connected = new Promise<void>((resolve, reject) => {
      socket!.once('connect', resolve);
      socket!.once('connect_error', reject);
    });
    socket.connect();
    await connected;
    const reply = await socket.timeout(2_000).emitWithAck('room:join', { roomId: 'example', displayName: 'Tester' });
    assert.equal(reply.ok, false);
    if (!reply.ok) assert.match(reply.error, /not implemented/);
  } finally {
    socket?.disconnect();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    database.close();
    await rm(clientDist, { recursive: true, force: true });
  }
});
