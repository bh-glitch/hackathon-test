import type { Database } from '../../../shared/database.js';
/** Arnav replaces this stub with SQLite migrations and a persistent Database. */
export function openDatabase(_path: string): Database {
  const unavailable = async (): Promise<never> => { throw new Error('Database module is not implemented yet.'); };
  return {
    createRoom: unavailable, getRoom: unavailable, upsertMember: unavailable,
    listMembers: unavailable, listMessages: unavailable, saveMessage: unavailable,
    createSession: unavailable, getSession: unavailable, close() {},
  };
}
