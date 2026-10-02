import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';
export type StudyRoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
/** Register listeners before connecting/joining. Same origin carries the session cookie. */
export function createRoomSocket(): StudyRoomSocket {
  return io({ autoConnect: false });
}
