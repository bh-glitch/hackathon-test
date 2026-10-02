import type { Server } from 'socket.io';
import type { ServerDependencies } from '../../../shared/database.js';
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from '../../../shared/types.js';
export type StudyRoomServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
/** Vansh replaces this stub, verifying the session cookie before allowing room access. */
export function initializeRealtime(io: StudyRoomServer, _dependencies: ServerDependencies): void {
  io.on('connection', (socket) => {
    socket.on('room:join', (_payload, ack) => {
      if (typeof ack === 'function') ack({ ok: false, error: 'Realtime module is not implemented yet.' });
    });
    socket.on('message:send', (_payload, ack) => {
      if (typeof ack === 'function') ack({ ok: false, error: 'Realtime module is not implemented yet.' });
    });
    socket.on('room:leave', (_payload, ack) => {
      if (typeof ack === 'function') ack({ ok: false, error: 'Realtime module is not implemented yet.' });
    });
  });
}
