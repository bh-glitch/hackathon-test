import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import Sqlite from 'better-sqlite3';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, Room, SessionResponse } from '../shared/types.js';
import { createStudyRoomServer } from '../server/src/index.js';
import { openDatabase } from '../server/src/db/index.js';

test('SQLite native dependency opens an independent in-memory database', () => {
  const sqlite = new Sqlite(':memory:');
  try { assert.deepEqual(sqlite.prepare('SELECT 1 AS ready').get(), { ready: 1 }); }
  finally { sqlite.close(); }
});

test('HTTP sessions, room creation, SPA fallback and durable Socket.IO chat work together', { timeout: 10_000 }, async () => {
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
    const sessionResponse = await fetch(`${origin}/api/session`, { method: 'POST' });
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json() as SessionResponse;
    const cookie = sessionResponse.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await fetch(`${origin}/api/rooms`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${origin}/api/rooms/example`)).status, 404);
    const created = await fetch(`${origin}/api/rooms`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Integration room' }),
    });
    assert.equal(created.status, 201);
    const room = await created.json() as Room;
    assert.deepEqual(await (await fetch(`${origin}/api/rooms/${room.id}`)).json(), room);
    const invalidJson = await fetch(`${origin}/api/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(invalidJson.status, 400);
    assert.deepEqual(await invalidJson.json(), { error: 'Invalid JSON body.' });
    socket = connect(origin, { autoConnect: false, reconnection: false, extraHeaders: { Cookie: cookie } });
    const connected = new Promise<void>((resolve, reject) => {
      socket!.once('connect', resolve);
      socket!.once('connect_error', reject);
    });
    socket.connect();
    await connected;
    const reply = await socket.timeout(2_000).emitWithAck('room:join', { roomId: room.id, displayName: 'Tester' });
    assert.equal(reply.ok, true);
    if (reply.ok) assert.deepEqual(reply.data.participants, [{ userId: session.userId, displayName: 'Tester', online: true }]);
    const message = await socket.timeout(2_000).emitWithAck('message:send', { roomId: room.id, clientMessageId: 'integration', text: 'Live chat works' });
    assert.equal(message.ok, true);
    if (message.ok) {
      assert.equal(message.data.senderId, session.userId);
      assert.deepEqual(await database.listMessages(room.id), [message.data]);
    }
  } finally {
    socket?.disconnect();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    database.close();
    await rm(clientDist, { recursive: true, force: true });
  }
});
