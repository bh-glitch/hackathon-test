import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test, { type TestContext } from 'node:test';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type { RoomDatabase, SessionStore, StoredMember, SaveMessageInput } from '../../../shared/database.js';
import {
  SESSION_COOKIE_NAME, type Ack, type Message, type Room, type RoomSnapshot,
  type ParticipantsUpdate, type ClientToServerEvents, type ServerToClientEvents,
} from '../../../shared/types.js';
import { initializeRealtime, type StudyRoomServer } from './index.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const room: Room = { id: 'room-a', name: 'Study', createdAt: '2026-10-01T00:00:00.000Z' };

class MemoryDatabase implements RoomDatabase, SessionStore {
  rooms = new Map<string, Room>([[room.id, room], ['room-b', { ...room, id: 'room-b' }]]);
  members = new Map<string, StoredMember>();
  messages = new Map<string, Message>();
  async createRoom() { return room; }
  async getRoom(roomId: string) { return this.rooms.get(roomId) ?? null; }
  async upsertMember(member: StoredMember) {
    this.members.set(JSON.stringify([member.roomId, member.userId]), { ...member });
    return { ...member };
  }
  async listMembers(roomId: string) {
    return [...this.members.values()].filter((member) => member.roomId === roomId).map((member) => ({ ...member }));
  }
  async listMessages(roomId: string) {
    return [...this.messages.values()].filter((message) => message.roomId === roomId);
  }
  async saveMessage(input: SaveMessageInput) {
    const key = JSON.stringify([input.roomId, input.senderId, input.clientMessageId]);
    const existing = this.messages.get(key);
    if (existing) return existing;
    const message: Message = {
      id: `message-${this.messages.size + 1}`, roomId: input.roomId, senderId: input.senderId,
      senderName: input.senderName, text: input.text, createdAt: new Date().toISOString(),
    };
    this.messages.set(key, message);
    return message;
  }
  async createSession() { return { sessionId: 'credential-alice', userId: 'alice' }; }
  async getSession(sessionId: string) {
    const userId = { 'credential-alice': 'alice', 'credential-bob': 'bob', 'credential-carol': 'carol' }[sessionId];
    return userId ? { sessionId, userId } : null;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t: TestContext) {
  const database = new MemoryDatabase();
  const http = createServer();
  const io: StudyRoomServer = new Server(http);
  initializeRealtime(io, { database, sessions: database });
  const clients: Client[] = [];
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
  function client(cookie?: string, transport: 'websocket' | 'polling' = 'websocket') {
    const socket: Client = connect(origin, {
      autoConnect: false, reconnection: false, transports: [transport],
      extraHeaders: cookie === undefined ? {} : { Cookie: cookie },
    });
    clients.push(socket);
    return socket;
  }
  async function user(name: 'alice' | 'bob' | 'carol', transport: 'websocket' | 'polling' = 'websocket') {
    const socket = client(`${SESSION_COOKIE_NAME}=credential-${name}`, transport);
    await connected(socket);
    return socket;
  }
  return { database, io, client, user };
}

async function connected(socket: Client) {
  const ready = new Promise<void>((resolve, reject) => {
    socket.once('connect', () => { socket.off('connect_error', reject); resolve(); });
    socket.once('connect_error', reject);
  });
  socket.connect();
  await ready;
}

function success<T>(ack: Ack<T>): T {
  if (!ack.ok) assert.fail(ack.error);
  assert.equal(ack.ok, true, JSON.stringify(ack));
  return ack.data;
}

function join(socket: Client, displayName: string, roomId = room.id): Promise<Ack<RoomSnapshot>> {
  return socket.timeout(2_000).emitWithAck('room:join', { roomId, displayName });
}

function send(socket: Client, clientMessageId: string, text: string, roomId = room.id): Promise<Ack<Message>> {
  return socket.timeout(2_000).emitWithAck('message:send', { roomId, clientMessageId, text });
}

function connectionError(socket: Client): Promise<Error> {
  return new Promise((resolve) => socket.once('connect_error', resolve));
}

function update(socket: Client, predicate: (event: ParticipantsUpdate) => boolean) {
  return new Promise<ParticipantsUpdate>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('participants:update', handler); reject(new Error('Presence timeout')); }, 2_000);
    const handler = (event: ParticipantsUpdate) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      socket.off('participants:update', handler);
      resolve(event);
    };
    socket.on('participants:update', handler);
  });
}

test('sessions are verified from cookies for WebSocket and polling; credentials are never public user IDs', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  for (const cookie of [undefined, `${SESSION_COOKIE_NAME}=alice`, `${SESSION_COOKIE_NAME}=%ZZ`,
    `${SESSION_COOKIE_NAME}=`, `${SESSION_COOKIE_NAME}=credential-alice; ${SESSION_COOKIE_NAME}=credential-bob`]) {
    const socket = f.client(cookie);
    const rejected = connectionError(socket);
    socket.connect();
    const error = await rejected;
    assert.match(error.message, /valid session cookie/);
    assert.equal(socket.connected, false);
  }
  const alice = f.client(`other=value; ${SESSION_COOKIE_NAME}=credential%2Dalice`);
  await connected(alice);
  assert.equal(f.io.sockets.sockets.get(alice.id!)?.data.userId, 'alice');
  const bob = await f.user('bob', 'polling');
  assert.equal(success(await join(bob, 'Bob')).participants[0].userId, 'bob');
  f.database.getSession = async () => { throw new Error('private database details'); };
  const rejected = f.client(`${SESSION_COOKIE_NAME}=credential-alice`);
  const failure = connectionError(rejected);
  rejected.connect();
  assert.equal((await failure).message, 'Unable to verify session.');
});

test('join trims names, retains offline members and attaches before reading all history', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  await f.database.upsertMember({ roomId: room.id, userId: 'carol', displayName: 'Carol' });
  const old = await f.database.saveMessage({ roomId: room.id, senderId: 'carol', senderName: 'Carol', clientMessageId: 'old', text: 'Earlier' });
  const alice = await f.user('alice');
  const listMessages = f.database.listMessages.bind(f.database);
  f.database.listMessages = async (roomId) => {
    assert(f.io.sockets.sockets.get(alice.id!)?.rooms.has(`study-room:${roomId}`));
    return listMessages(roomId);
  };
  const snapshot = success(await join(alice, '  Alice  '));
  assert.deepEqual(snapshot.room, room);
  assert.deepEqual(snapshot.messages, [old]);
  assert.deepEqual(snapshot.participants, [
    { userId: 'carol', displayName: 'Carol', online: false },
    { userId: 'alice', displayName: 'Alice', online: true },
  ]);
  success(await join(alice, 'Alice again'));
  assert.equal((await f.database.listMembers(room.id)).length, 2);
});

test('messages save before broadcast/ack, derive identity, deduplicate retries and stay in their room', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const alice = await f.user('alice');
  const bob = await f.user('bob');
  const carol = await f.user('carol');
  success(await join(alice, 'Alice'));
  success(await join(bob, 'Bob'));
  success(await join(carol, 'Carol', 'room-b'));
  const aliceMessages: Message[] = [], bobMessages: Message[] = [], carolMessages: Message[] = [];
  alice.on('message:new', (message) => aliceMessages.push(message));
  bob.on('message:new', (message) => bobMessages.push(message));
  carol.on('message:new', (message) => carolMessages.push(message));
  const entered = deferred<void>(), persisted = deferred<void>();
  const save = f.database.saveMessage.bind(f.database);
  f.database.saveMessage = async (input) => { entered.resolve(); await persisted.promise; return save(input); };
  let acknowledged = false;
  const first: Promise<Ack<Message>> = alice.timeout(2_000).emitWithAck('message:send', {
    roomId: room.id, clientMessageId: 'retry', text: '  Hello  ',
    ...{ senderId: 'carol', senderName: 'Spoofed' },
  }).then((ack) => { acknowledged = true; return ack; });
  await entered.promise;
  assert.equal(acknowledged, false);
  assert.deepEqual(aliceMessages, []);
  assert.deepEqual(bobMessages, []);
  const received = new Promise<Message>((resolve) => bob.once('message:new', resolve));
  persisted.resolve();
  const message = success(await first);
  assert.deepEqual(await received, message);
  assert.equal(message.senderId, 'alice');
  assert.equal(message.senderName, 'Alice');
  assert.equal(message.text, 'Hello');
  assert.deepEqual(success(await send(alice, 'retry', 'Changed retry')), message);
  assert.equal(f.database.messages.size, 1);
  assert.equal(aliceMessages.length, 2);
  assert.deepEqual(carolMessages, []);
  assert.equal((await send(alice, 'unjoined', 'No', 'room-b')).ok, false);
  const bobMessage = success(await send(bob, 'retry', 'Different sender'));
  assert.notEqual(bobMessage.id, message.id);
});

test('multiple tabs stay online until the last leaves; saved membership remains and cannot send after leave', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const observer = await f.user('bob');
  const first = await f.user('alice');
  const second = await f.user('alice');
  success(await join(observer, 'Bob'));
  success(await join(first, 'Alice'));
  success(await join(second, 'Alice updated'));
  assert.equal(success(await send(first, 'name', 'Hello')).senderName, 'Alice updated');
  const stillOnline = update(observer, (event) => event.participants.some((p) => p.userId === 'alice' && p.online));
  first.disconnect();
  await stillOnline;
  const offline = update(observer, (event) => event.participants.some((p) => p.userId === 'alice' && !p.online));
  success(await second.timeout(2_000).emitWithAck('room:leave', { roomId: room.id }));
  assert((await offline).participants.some((p) => p.displayName === 'Alice updated' && !p.online));
  assert.equal((await send(second, 'left', 'No')).ok, false);
  success(await second.timeout(2_000).emitWithAck('room:leave', { roomId: room.id }));
  assert.equal((await f.database.listMembers(room.id)).length, 2);
});

test('reconnect verifies the session again, requires rejoin and catches up history using the same identity', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const alice = await f.user('alice');
  const bob = await f.user('bob');
  success(await join(alice, 'Alice'));
  success(await join(bob, 'Bob'));
  const prior = success(await send(alice, 'original', 'Before reconnect'));
  const offline = update(bob, (event) => event.participants.some((p) => p.userId === 'alice' && !p.online));
  const oldId = alice.id;
  alice.disconnect();
  await offline;
  const missed = success(await send(bob, 'missed', 'While offline'));
  await connected(alice);
  assert.notEqual(alice.id, oldId);
  assert.equal((await send(alice, 'premature', 'No')).ok, false);
  const snapshot = success(await join(alice, 'Alice'));
  assert.deepEqual(snapshot.messages, [prior, missed]);
  assert.equal(snapshot.participants.filter((p) => p.userId === 'alice').length, 1);
  assert(snapshot.participants.find((p) => p.userId === 'alice')?.online);
  assert.deepEqual(success(await send(alice, 'original', 'Retry after reconnect')), prior);
});

test('malformed requests, missing rooms and boundary lengths produce failed acknowledgements', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const alice = await f.user('alice');
  for (const payload of [null, [], {}, { roomId: 1, displayName: 'A' }, { roomId: room.id, displayName: ' ' },
    { roomId: room.id, displayName: 'x'.repeat(41) }, { roomId: 'missing', displayName: 'Alice' }]) {
    assert.equal((await alice.timeout(2_000).emitWithAck('room:join', payload as never)).ok, false);
  }
  success(await join(alice, 'x'.repeat(40)));
  for (const payload of [null, [], {}, { roomId: room.id, clientMessageId: '', text: 'Hi' },
    { roomId: room.id, clientMessageId: 'x', text: ' ' }, { roomId: room.id, clientMessageId: 'x', text: 5 },
    { roomId: room.id, clientMessageId: 'x', text: 'x'.repeat(2001) }]) {
    assert.equal((await alice.timeout(2_000).emitWithAck('message:send', payload as never)).ok, false);
  }
  assert.equal(success(await send(alice, 'boundary', 'x'.repeat(2000))).text.length, 2000);
  assert.equal((await alice.timeout(2_000).emitWithAck('room:leave', null as never)).ok, false);
});

test('failed saves never broadcast and can be retried; missing persistent membership denies sending', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const alice = await f.user('alice');
  success(await join(alice, 'Alice'));
  const events: Message[] = [];
  alice.on('message:new', (message) => events.push(message));
  const save = f.database.saveMessage.bind(f.database);
  f.database.saveMessage = async () => { throw new Error('secret storage failure'); };
  assert.deepEqual(await send(alice, 'retry', 'Hi'), { ok: false, error: 'Unable to save message.' });
  assert.deepEqual(events, []);
  f.database.saveMessage = save;
  success(await send(alice, 'retry', 'Hi'));
  f.database.members.clear();
  assert.equal((await send(alice, 'deleted-membership', 'No')).ok, false);
});

test('history failure rolls back transport and presence while retaining offline membership', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const bob = await f.user('bob');
  const alice = await f.user('alice');
  success(await join(bob, 'Bob'));
  const list = f.database.listMessages.bind(f.database);
  f.database.listMessages = async () => { throw new Error('private storage details'); };
  const offline = update(bob, (event) => event.participants.some((p) => p.userId === 'alice' && !p.online));
  assert.deepEqual(await join(alice, 'Alice'), { ok: false, error: 'Unable to join room.' });
  await offline;
  assert.equal(f.io.sockets.sockets.get(alice.id!)?.rooms.has(`study-room:${room.id}`), false);
  assert.equal((await send(alice, 'failed-join', 'No')).ok, false);
  f.database.listMessages = list;
  success(await join(alice, 'Alice'));
});

test('disconnect during history loading cannot leave ghost presence; other rooms keep working', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const bob = await f.user('bob');
  const alice = await f.user('alice');
  const carol = await f.user('carol');
  success(await join(bob, 'Bob'));
  success(await join(carol, 'Carol', 'room-b'));
  const loading = deferred<void>(), resume = deferred<Message[]>();
  const list = f.database.listMessages.bind(f.database);
  f.database.listMessages = async (roomId) => {
    if (roomId !== room.id) return list(roomId);
    loading.resolve();
    return resume.promise;
  };
  alice.emit('room:join', { roomId: room.id, displayName: 'Alice' }, () => {});
  await loading.promise;
  success(await send(carol, 'independent', 'Other room works', 'room-b'));
  const serverSocket = f.io.sockets.sockets.get(alice.id!)!;
  const disconnected = once(serverSocket, 'disconnect');
  alice.disconnect();
  await disconnected;
  const offline = update(bob, (event) => event.participants.some((p) => p.userId === 'alice' && !p.online));
  resume.resolve([]);
  await offline;
  f.database.listMessages = list;
  const snapshot = success(await join(bob, 'Bob'));
  assert.equal(snapshot.participants.find((p) => p.userId === 'alice')?.online, false);
});

test('pipelined join/send/leave follow room order and do not permit sends after leaving', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const alice = await f.user('alice');
  const joining = join(alice, 'Alice');
  const sending = send(alice, 'pipeline', 'Hi');
  const leaving = alice.timeout(2_000).emitWithAck('room:leave', { roomId: room.id });
  const after = send(alice, 'after', 'No');
  success(await joining);
  success(await sending);
  success(await leaving);
  assert.equal((await after).ok, false);
});

test('a restarted realtime server rebuilds presence from rejoining sockets and reloads stored history', { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const alice = await f.user('alice');
  success(await join(alice, 'Alice'));
  const saved = success(await send(alice, 'saved', 'Survives'));
  await new Promise<void>((resolve) => f.io.close(() => resolve()));
  // Reuse the store to model the shared persistence contract, without Arnav's SQLite module.
  const http = createServer();
  const io: StudyRoomServer = new Server(http);
  initializeRealtime(io, { database: f.database, sessions: f.database });
  t.after(async () => { await new Promise<void>((resolve) => io.close(() => resolve())); });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  assert(address && typeof address !== 'string');
  const bob: Client = connect(`http://127.0.0.1:${address.port}`, {
    autoConnect: false, reconnection: false, transports: ['websocket'],
    extraHeaders: { Cookie: `${SESSION_COOKIE_NAME}=credential-bob` },
  });
  t.after(() => { bob.disconnect(); });
  await connected(bob);
  const snapshot: RoomSnapshot = success(await join(bob, 'Bob'));
  assert.deepEqual(snapshot.messages, [saved]);
  assert.equal(snapshot.participants.find((p) => p.userId === 'alice')?.online, false);
});
