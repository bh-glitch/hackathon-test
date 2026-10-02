import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Sqlite from 'better-sqlite3';
import type {
  AnonymousSession,
  Database,
  SaveMessageInput,
  StoredMember,
} from '../../../shared/database.js';
import type { Message, Room } from '../../../shared/types.js';

type RoomRow = { id: string; name: string; createdAt: string };
type MemberRow = { roomId: string; userId: string; displayName: string };
type MessageRow = Message;
type SessionRow = { sessionId: string; userId: string };

const schema = `
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    client_message_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    UNIQUE (room_id, sender_id, client_message_id)
  );

  CREATE INDEX IF NOT EXISTS messages_room_history
    ON messages(room_id, created_at, id);

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
`;

const latestSchemaVersion = 1;

function prepareParentDirectory(path: string): void {
  if (path === ':memory:' || path.startsWith('file:')) return;
  const parent = dirname(path);
  if (parent !== '.') mkdirSync(parent, { recursive: true });
}

/** Open the SQLite store and apply all idempotent schema migrations. */
export function openDatabase(path: string): Database {
  prepareParentDirectory(path);
  const sqlite = new Sqlite(path);

  try {
    sqlite.pragma('foreign_keys = ON');
    const currentVersion = sqlite.pragma('user_version', { simple: true }) as number;
    if (currentVersion > latestSchemaVersion) {
      throw new Error(`Database schema version ${currentVersion} is newer than supported version ${latestSchemaVersion}.`);
    }
    if (currentVersion < 1) {
      sqlite.transaction(() => {
        sqlite.exec(schema);
        sqlite.pragma('user_version = 1');
      })();
    }
  } catch (error) {
    sqlite.close();
    throw error;
  }

  const insertRoom = sqlite.prepare(`
    INSERT INTO rooms (id, name, created_at) VALUES (?, ?, ?)
  `);
  const selectRoom = sqlite.prepare(`
    SELECT id, name, created_at AS createdAt FROM rooms WHERE id = ?
  `);
  const upsertRoomMember = sqlite.prepare(`
    INSERT INTO room_members (room_id, user_id, display_name)
    VALUES (@roomId, @userId, @displayName)
    ON CONFLICT (room_id, user_id) DO UPDATE SET display_name = excluded.display_name
  `);
  const selectMembers = sqlite.prepare(`
    SELECT room_id AS roomId, user_id AS userId, display_name AS displayName
    FROM room_members
    WHERE room_id = ?
    ORDER BY display_name COLLATE NOCASE, user_id
  `);
  const selectMessages = sqlite.prepare(`
    SELECT id, room_id AS roomId, sender_id AS senderId, sender_name AS senderName,
           text, created_at AS createdAt
    FROM messages
    WHERE room_id = ?
    ORDER BY created_at, id
  `);
  const insertMessage = sqlite.prepare(`
    INSERT INTO messages (
      id, room_id, sender_id, sender_name, client_message_id, text, created_at
    ) VALUES (
      @id, @roomId, @senderId, @senderName, @clientMessageId, @text, @createdAt
    )
    ON CONFLICT (room_id, sender_id, client_message_id) DO NOTHING
  `);
  const selectMessageByClientId = sqlite.prepare(`
    SELECT id, room_id AS roomId, sender_id AS senderId, sender_name AS senderName,
           text, created_at AS createdAt
    FROM messages
    WHERE room_id = ? AND sender_id = ? AND client_message_id = ?
  `);
  const insertSession = sqlite.prepare(`
    INSERT INTO sessions (session_id, user_id, created_at) VALUES (?, ?, ?)
  `);
  const selectSession = sqlite.prepare(`
    SELECT session_id AS sessionId, user_id AS userId FROM sessions WHERE session_id = ?
  `);

  const saveMessageTransaction = sqlite.transaction((input: SaveMessageInput): Message => {
    const message: Message & { clientMessageId: string } = {
      id: randomUUID(),
      roomId: input.roomId,
      senderId: input.senderId,
      senderName: input.senderName,
      clientMessageId: input.clientMessageId,
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    insertMessage.run(message);
    const saved = selectMessageByClientId.get(
      input.roomId,
      input.senderId,
      input.clientMessageId,
    ) as MessageRow | undefined;
    if (!saved) throw new Error('Message could not be saved.');
    return saved;
  });

  return {
    async createRoom({ name }): Promise<Room> {
      const room = { id: randomUUID(), name, createdAt: new Date().toISOString() };
      insertRoom.run(room.id, room.name, room.createdAt);
      return room;
    },

    async getRoom(roomId): Promise<Room | null> {
      return (selectRoom.get(roomId) as RoomRow | undefined) ?? null;
    },

    async upsertMember(input): Promise<StoredMember> {
      upsertRoomMember.run(input);
      return { ...input };
    },

    async listMembers(roomId): Promise<StoredMember[]> {
      return selectMembers.all(roomId) as MemberRow[];
    },

    async listMessages(roomId): Promise<Message[]> {
      return selectMessages.all(roomId) as MessageRow[];
    },

    async saveMessage(input): Promise<Message> {
      return saveMessageTransaction(input);
    },

    async createSession(): Promise<AnonymousSession> {
      const session = { sessionId: randomUUID(), userId: randomUUID() };
      insertSession.run(session.sessionId, session.userId, new Date().toISOString());
      return session;
    },

    async getSession(sessionId): Promise<AnonymousSession | null> {
      return (selectSession.get(sessionId) as SessionRow | undefined) ?? null;
    },

    close(): void {
      sqlite.close();
    },
  };
}
