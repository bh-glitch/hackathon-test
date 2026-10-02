import type { Server } from 'socket.io';
import type { ServerDependencies } from '../../../shared/database.js';
import {
  MAX_MESSAGE_LENGTH, PROPOSED_MAX_DISPLAY_NAME_LENGTH, SESSION_COOKIE_NAME,
  type Acknowledge, type ClientToServerEvents, type ServerToClientEvents,
  type InterServerEvents, type SocketData, type Participant,
} from '../../../shared/types.js';

export type StudyRoomServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

class RequestError extends Error {}

function objectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RequestError('Invalid request payload.');
  }
  return payload as Record<string, unknown>;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new RequestError(`${label} is required.`);
  return value;
}

function sessionCookie(header: string | undefined): string | null {
  const values = (header ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf('=')) === SESSION_COOKIE_NAME);
  // Ambiguous credentials should not select an arbitrary identity.
  if (values.length !== 1) return null;
  try {
    return decodeURIComponent(values[0].slice(values[0].indexOf('=') + 1)) || null;
  } catch { return null; }
}

/** Presence is process-local; saved memberships and sessions belong to the database. */
export function initializeRealtime(io: StudyRoomServer, dependencies: ServerDependencies): void {
  const { database, sessions } = dependencies;
  const presence = new Map<string, Map<string, Set<string>>>();
  const pending = new Map<string, Promise<unknown>>();
  const channel = (roomId: string) => `study-room:${roomId}`;

  // Order mutations and snapshots within each room so concurrent tabs cannot publish
  // stale presence, race display-name changes, or overtake an unfinished join.
  function inRoom<T>(roomId: string, operation: () => Promise<T>): Promise<T> {
    const task = (pending.get(roomId) ?? Promise.resolve()).catch(() => {}).then(operation);
    pending.set(roomId, task);
    void task.then(() => {
      if (pending.get(roomId) === task) pending.delete(roomId);
    }, () => {
      if (pending.get(roomId) === task) pending.delete(roomId);
    });
    return task;
  }

  function addPresence(roomId: string, userId: string, socketId: string): void {
    let users = presence.get(roomId);
    if (!users) presence.set(roomId, users = new Map());
    let sockets = users.get(userId);
    if (!sockets) users.set(userId, sockets = new Set());
    sockets.add(socketId);
  }

  function removePresence(roomId: string, userId: string, socketId: string): void {
    const users = presence.get(roomId);
    const sockets = users?.get(userId);
    sockets?.delete(socketId);
    if (!sockets?.size) users?.delete(userId);
    if (!users?.size) presence.delete(roomId);
  }

  async function participants(roomId: string): Promise<Participant[]> {
    const members = await database.listMembers(roomId);
    return members.map(({ userId, displayName }) => ({
      userId, displayName, online: Boolean(presence.get(roomId)?.get(userId)?.size),
    }));
  }

  async function publishPresence(roomId: string): Promise<Participant[]> {
    const current = await participants(roomId);
    io.to(channel(roomId)).emit('participants:update', { roomId, participants: current });
    return current;
  }

  io.use((socket, next) => {
    const credential = sessionCookie(socket.handshake.headers.cookie);
    if (!credential) { next(new Error('A valid session cookie is required.')); return; }
    void sessions.getSession(credential).then((session) => {
      if (!session?.userId) { next(new Error('A valid session cookie is required.')); return; }
      socket.data.userId = session.userId;
      next();
    }, () => next(new Error('Unable to verify session.')));
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId!;
    const joined = new Set<string>();

    function requireConnected(): void {
      if (!socket.connected) throw new RequestError('Socket disconnected; rejoin the room.');
    }

    function requireMembership(roomId: string): void {
      requireConnected();
      if (!joined.has(roomId) || !socket.rooms.has(channel(roomId))) {
        throw new RequestError('Join the room before sending messages.');
      }
    }

    async function request<T>(ack: Acknowledge<T>, fallback: string, operation: () => Promise<T>): Promise<void> {
      let result;
      try { result = { ok: true as const, data: await operation() }; }
      catch (error) {
        result = { ok: false as const, error: error instanceof RequestError ? error.message : fallback };
      }
      if (typeof ack === 'function') ack(result);
    }

    socket.on('room:join', (payload, ack) => {
      void request(ack, 'Unable to join room.', async () => {
        const input = objectPayload(payload);
        const roomId = identifier(input.roomId, 'Room ID');
        const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
        if (!displayName || displayName.length > PROPOSED_MAX_DISPLAY_NAME_LENGTH) {
          throw new RequestError(`Display name must be 1–${PROPOSED_MAX_DISPLAY_NAME_LENGTH} characters.`);
        }
        return inRoom(roomId, async () => {
          requireConnected();
          const room = await database.getRoom(roomId);
          if (!room) throw new RequestError('Room not found.');
          await database.upsertMember({ roomId, userId, displayName });
          requireConnected();
          const alreadyJoined = joined.has(roomId);
          try {
            // Attach before reading history. Clients buffer events until this ack.
            await socket.join(channel(roomId));
            requireConnected();
            joined.add(roomId);
            addPresence(roomId, userId, socket.id);
            const messages = await database.listMessages(roomId);
            requireConnected();
            const current = await publishPresence(roomId);
            requireConnected();
            return { room, messages, participants: current };
          } catch (error) {
            if (!alreadyJoined) {
              joined.delete(roomId);
              removePresence(roomId, userId, socket.id);
              await socket.leave(channel(roomId));
            }
            // A failed history/presence read must not leave a new tab online.
            await publishPresence(roomId).catch(() => {});
            throw error;
          }
        });
      });
    });

    socket.on('message:send', (payload, ack) => {
      void request(ack, 'Unable to save message.', async () => {
        const input = objectPayload(payload);
        const roomId = identifier(input.roomId, 'Room ID');
        const clientMessageId = identifier(input.clientMessageId, 'Client message ID');
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > MAX_MESSAGE_LENGTH) {
          throw new RequestError(`Message must be 1–${MAX_MESSAGE_LENGTH} characters.`);
        }
        const text = input.text.trim();
        return inRoom(roomId, async () => {
          requireMembership(roomId);
          const member = (await database.listMembers(roomId)).find((candidate) => candidate.userId === userId);
          if (!member) throw new RequestError('Room membership not found; rejoin the room.');
          requireMembership(roomId);
          const message = await database.saveMessage({
            roomId, senderId: userId, senderName: member.displayName, clientMessageId, text,
          });
          // The database atomically deduplicates retries; rebroadcasting the original
          // also lets clients merge by message ID after losing an acknowledgement.
          io.to(channel(roomId)).emit('message:new', message);
          return message;
        });
      });
    });

    socket.on('room:leave', (payload, ack) => {
      void request(ack, 'Unable to leave room.', async () => {
        const roomId = identifier(objectPayload(payload).roomId, 'Room ID');
        return inRoom(roomId, async () => {
          requireConnected();
          if (joined.has(roomId)) {
            await socket.leave(channel(roomId));
            joined.delete(roomId);
            removePresence(roomId, userId, socket.id);
            await publishPresence(roomId);
          }
          return null;
        });
      });
    });

    socket.on('disconnect', () => {
      for (const roomId of joined) {
        removePresence(roomId, userId, socket.id);
        void inRoom(roomId, () => publishPresence(roomId)).catch(() => {});
      }
      joined.clear();
    });
  });
}
