import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from './index.js';

test('rooms, members, messages, and sessions survive reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'study-room-db-'));
  const path = join(directory, 'nested', 'study-room.sqlite');
  let database = openDatabase(path);

  try {
    const session = await database.createSession();
    const room = await database.createRoom({ name: 'Algorithms' });
    await database.upsertMember({ roomId: room.id, userId: session.userId, displayName: 'Arnav' });
    const message = await database.saveMessage({
      roomId: room.id,
      senderId: session.userId,
      senderName: 'Arnav',
      clientMessageId: 'client-message-1',
      text: 'First message',
    });
    database.close();

    database = openDatabase(path);
    assert.deepEqual(await database.getSession(session.sessionId), session);
    assert.deepEqual(await database.getRoom(room.id), room);
    assert.deepEqual(await database.listMembers(room.id), [
      { roomId: room.id, userId: session.userId, displayName: 'Arnav' },
    ]);
    assert.deepEqual(await database.listMessages(room.id), [message]);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('member updates are retained and duplicate sends return the original message', async () => {
  const database = openDatabase(':memory:');
  try {
    const room = await database.createRoom({ name: 'Databases' });
    await database.upsertMember({ roomId: room.id, userId: 'user-1', displayName: 'Old name' });
    await database.upsertMember({ roomId: room.id, userId: 'user-1', displayName: 'New name' });
    assert.deepEqual(await database.listMembers(room.id), [
      { roomId: room.id, userId: 'user-1', displayName: 'New name' },
    ]);

    const first = await database.saveMessage({
      roomId: room.id,
      senderId: 'user-1',
      senderName: 'New name',
      clientMessageId: 'retry-key',
      text: 'Save exactly once',
    });
    const retry = await database.saveMessage({
      roomId: room.id,
      senderId: 'user-1',
      senderName: 'Changed on retry',
      clientMessageId: 'retry-key',
      text: 'This must not replace the original',
    });

    assert.deepEqual(retry, first);
    assert.deepEqual(await database.listMessages(room.id), [first]);
  } finally {
    database.close();
  }
});

test('duplicate client message IDs remain independent across senders and rooms', async () => {
  const database = openDatabase(':memory:');
  try {
    const firstRoom = await database.createRoom({ name: 'First' });
    const secondRoom = await database.createRoom({ name: 'Second' });
    const common = { clientMessageId: 'shared-key', senderName: 'Arnav', text: 'Hello' };

    const messages = await Promise.all([
      database.saveMessage({ ...common, roomId: firstRoom.id, senderId: 'user-1' }),
      database.saveMessage({ ...common, roomId: firstRoom.id, senderId: 'user-2' }),
      database.saveMessage({ ...common, roomId: secondRoom.id, senderId: 'user-1' }),
    ]);

    assert.equal(new Set(messages.map(({ id }) => id)).size, 3);
    assert.equal((await database.listMessages(firstRoom.id)).length, 2);
    assert.equal((await database.listMessages(secondRoom.id)).length, 1);
  } finally {
    database.close();
  }
});
