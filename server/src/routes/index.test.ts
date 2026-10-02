import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { SESSION_COOKIE_NAME } from '../../../shared/types.js';
import { openDatabase } from '../db/index.js';
import { createApiRouter } from './index.js';

test('session bootstrap restores identity and authorizes room creation', async () => {
  const database = openDatabase(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter({ database, sessions: database }));
  const server = createServer(app);

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;

    const unauthenticated = await fetch(`${origin}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Blocked' }),
    });
    assert.equal(unauthenticated.status, 401);

    const bootstrap = await fetch(`${origin}/api/session`, { method: 'POST' });
    assert.equal(bootstrap.status, 200);
    const identity = await bootstrap.json() as { userId: string };
    const setCookie = bootstrap.headers.get('set-cookie');
    assert(setCookie);
    assert.match(setCookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(';', 1)[0];

    const restored = await fetch(`${origin}/api/session`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.deepEqual(await restored.json(), identity);

    const created = await fetch(`${origin}/api/rooms`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  Systems Study  ' }),
    });
    assert.equal(created.status, 201);
    const room = await created.json() as { id: string; name: string; createdAt: string };
    assert.equal(room.name, 'Systems Study');

    const found = await fetch(`${origin}/api/rooms/${room.id}`);
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), room);
    assert.equal((await fetch(`${origin}/api/rooms/missing`)).status, 404);
  } finally {
    server.close();
    await once(server, 'close');
    database.close();
  }
});

test('room creation validates the request body and rejects unknown sessions', async () => {
  const database = openDatabase(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter({ database, sessions: database }));
  const server = createServer(app);

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const sessionResponse = await fetch(`${origin}/api/session`, { method: 'POST' });
    const cookie = sessionResponse.headers.get('set-cookie')!.split(';', 1)[0];

    for (const body of [{}, { name: 42 }, { name: '   ' }]) {
      const response = await fetch(`${origin}/api/rooms`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'Room name is required.' });
    }

    const unknown = await fetch(`${origin}/api/rooms`, {
      method: 'POST',
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=unknown`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'No access' }),
    });
    assert.equal(unknown.status, 401);
  } finally {
    server.close();
    await once(server, 'close');
    database.close();
  }
});
