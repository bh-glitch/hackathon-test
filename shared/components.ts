import type { ConnectionStatus, Message, Participant } from './types.js';
export type MessageListProps = {
  messages: readonly Message[]; currentUserId: string | null; loading: boolean; error: string | null;
};
/** Controlled draft survives reconnects. App owns retries and clientMessageId. */
export type MessageComposerProps = {
  value: string; onChange: (value: string) => void; onSend: () => void;
  disabled: boolean; sending: boolean; error: string | null;
};
export type ParticipantSidebarProps = {
  participants: readonly Participant[]; currentUserId: string | null; status: ConnectionStatus;
};
export type JoinRoomFormProps = {
  displayName: string; onDisplayNameChange: (value: string) => void;
  onJoin: () => void; joining: boolean; error: string | null;
};
