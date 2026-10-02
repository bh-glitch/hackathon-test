import assert from 'node:assert/strict';
import test from 'node:test';
import type { Ack, Message, RoomSnapshot } from '../../../shared/types';
import { initialRoomState, mergeMessages, RoomConnection, type RoomConnectionState } from './room-connection';
import type { StudyRoomSocket } from './socket';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

class Transport {
  connected = false;
  listeners = new Map<string, Set<(...args: never[]) => void>>();
  requests: { event: string; payload: unknown; response: ReturnType<typeof deferred<unknown>> }[] = [];
  on(event: string, listener: (...args: never[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: string, listener: (...args: never[]) => void) { this.listeners.get(event)?.delete(listener); }
  fire(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args as never[]);
  }
  connect() { this.connected = true; this.fire('connect'); }
  disconnect() { this.connected = false; this.fire('disconnect'); }
  timeout() { return this; }
  emitWithAck(event: string, payload: unknown) {
    const response = deferred<unknown>();
    this.requests.push({ event, payload, response });
    return response.promise;
  }
}

const first: Message = { id: 'a', roomId: 'room', senderId: 'alice', senderName: 'Alice', text: 'First', createdAt: '2026-10-02T00:00:00.000Z' };
const second: Message = { ...first, id: 'b', text: 'Second' };
const snapshot: RoomSnapshot = {
  room: { id: 'room', name: 'Study', createdAt: first.createdAt }, messages: [first],
  participants: [{ userId: 'alice', displayName: 'Alice', online: true }],
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  const socket = new Transport();
  let state = initialRoomState();
  const connection = new RoomConnection(socket as unknown as StudyRoomSocket, 'room', 'Alice', (next) => { state = next; });
  return { socket, connection, get state(): RoomConnectionState { return state; } };
}

test('messages merge by ID and sort by timestamp with an ID tie-breaker', () => {
  const later = { ...first, id: 'c', createdAt: '2026-10-02T00:00:01.000Z' };
  assert.deepEqual(mergeMessages([second, later], [first, second]), [first, second, later]);
});

test('listeners buffer live events before join ack and keep latest presence without duplicates', async () => {
  const f = fixture();
  f.connection.start();
  assert.equal(f.state.status, 'connecting');
  f.socket.fire('message:new', second);
  f.socket.fire('message:new', first);
  f.socket.fire('message:new', { ...second, id: 'foreign', roomId: 'other' });
  const participants = [...snapshot.participants, { userId: 'bob', displayName: 'Bob', online: true }];
  f.socket.fire('participants:update', { roomId: 'room', participants });
  f.socket.requests[0].response.resolve({ ok: true, data: snapshot });
  await flush();
  assert.equal(f.state.status, 'joined');
  assert.deepEqual(f.state.messages, [first, second]);
  assert.deepEqual(f.state.participants, participants);
  f.socket.fire('message:new', second);
  assert.equal(f.state.messages.length, 2);
});

test('disconnect invalidates old acknowledgements, blocks sends and rejoins with fresh history', async () => {
  const f = fixture();
  f.connection.start();
  const old = f.socket.requests[0];
  f.socket.disconnect();
  old.response.resolve({ ok: true, data: snapshot });
  await flush();
  assert.equal(f.state.status, 'reconnecting');
  await assert.rejects(f.connection.send({ roomId: 'room', clientMessageId: 'key', text: 'Draft' }), /Reconnect/);
  assert.equal(f.socket.requests.length, 1);
  f.socket.connect();
  f.socket.requests[1].response.resolve({ ok: true, data: { ...snapshot, messages: [first, second] } });
  await flush();
  assert.equal(f.state.status, 'joined');
  assert.deepEqual(f.state.messages, [first, second]);
  f.socket.disconnect();
  assert.equal(f.state.participants[0].online, false);
  assert.equal(f.state.messages.length, 2);
});

test('send errors and lost acknowledgements preserve retry IDs; success and broadcasts merge once', async () => {
  const f = fixture();
  f.connection.start();
  f.socket.requests[0].response.resolve({ ok: true, data: snapshot });
  await flush();
  const input = { roomId: 'room', clientMessageId: 'same-key', text: 'Second' };
  const failed = f.connection.send(input);
  f.socket.requests[1].response.resolve({ ok: false, error: 'Save failed' } satisfies Ack<Message>);
  await assert.rejects(failed, /Save failed/);
  const lost = f.connection.send(input);
  f.socket.fire('message:new', second);
  f.socket.requests[2].response.reject(new Error('operation has timed out'));
  await assert.rejects(lost, /timed out/);
  const retry = f.connection.send(input);
  assert.deepEqual(f.socket.requests[3].payload, input);
  f.socket.fire('message:new', second);
  f.socket.requests[3].response.resolve({ ok: true, data: second });
  assert.deepEqual(await retry, second);
  assert.deepEqual(f.state.messages, [first, second]);
});

test('failed joins and connection errors offer retry; stopping detaches listeners and ignores pending acks', async () => {
  const f = fixture();
  f.connection.start();
  f.socket.requests[0].response.resolve({ ok: false, error: 'Room not found' });
  await flush();
  assert.equal(f.state.error, 'Room not found');
  assert.equal(f.state.status, 'error');
  f.connection.retry();
  assert.equal(f.state.error, null);
  assert.equal(f.socket.requests.length, 2);
  f.socket.fire('connect_error', new Error('network unavailable'));
  assert.match(f.state.error!, /network unavailable/);
  const state = f.state;
  f.connection.stop();
  f.socket.requests[1].response.resolve({ ok: true, data: snapshot });
  f.socket.fire('message:new', first);
  await flush();
  assert.equal(f.state, state);
  for (const listeners of f.socket.listeners.values()) assert.equal(listeners.size, 0);
});
