/** Wire contracts: timestamps are server-generated UTC ISO strings; IDs are opaque. */
export type Room = { id: string; name: string; createdAt: string };
export type Message = {
  id: string; roomId: string; senderId: string; senderName: string;
  text: string; createdAt: string;
};
export type Participant = { userId: string; displayName: string; online: boolean };
export type RoomSnapshot = { room: Room; messages: Message[]; participants: Participant[] };
export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };
export type CreateRoomRequest = { name: string };
export type SessionResponse = { userId: string };
export type ApiError = { error: string };
export type JoinRoomRequest = { roomId: string; displayName: string };
export type SendMessageRequest = { roomId: string; clientMessageId: string; text: string };
export type LeaveRoomRequest = { roomId: string };
export type ParticipantsUpdate = { roomId: string; participants: Participant[] };
export type Acknowledge<T> = (result: Ack<T>) => void;
export interface ClientToServerEvents {
  'room:join': (payload: JoinRoomRequest, ack: Acknowledge<RoomSnapshot>) => void;
  'message:send': (payload: SendMessageRequest, ack: Acknowledge<Message>) => void;
  'room:leave': (payload: LeaveRoomRequest, ack: Acknowledge<null>) => void;
}
export interface ServerToClientEvents {
  'message:new': (message: Message) => void;
  'participants:update': (update: ParticipantsUpdate) => void;
}
export type InterServerEvents = Record<string, never>;
/** Set only after the server verifies the anonymous session cookie. */
export type SocketData = { userId?: string };
export type ConnectionStatus = 'idle' | 'connecting' | 'joined' | 'reconnecting' | 'error';
export const MAX_MESSAGE_LENGTH = 2_000;
/** Proposed limit; confirm before implementing validation. */
export const PROPOSED_MAX_DISPLAY_NAME_LENGTH = 40;
export const SESSION_COOKIE_NAME = 'study_room_session';
