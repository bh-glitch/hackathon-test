import type {
  Ack, ConnectionStatus, Message, Participant, RoomSnapshot, SendMessageRequest,
} from '../../../shared/types';
import type { StudyRoomSocket } from './socket';

export type RoomConnectionState = {
  status: ConnectionStatus;
  messages: Message[];
  participants: Participant[];
  error: string | null;
  joinedOnce: boolean;
};

export function initialRoomState(): RoomConnectionState {
  return { status: 'idle', messages: [], participants: [], error: null, joinedOnce: false };
}

export function mergeMessages(...groups: readonly Message[][]): Message[] {
  const messages = new Map<string, Message>();
  for (const group of groups) for (const message of group) messages.set(message.id, message);
  return [...messages.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function createClientMessageId(): string {
  // randomUUID requires a secure context; local Wi-Fi demo URLs may use HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Owns transport state; React owns the draft and retains retry IDs across reconnects. */
export class RoomConnection {
  private state = initialRoomState();
  private generation = 0;
  private stopped = false;
  private buffered: Message[] = [];
  private bufferedParticipants: Participant[] | null = null;

  constructor(
    private socket: StudyRoomSocket,
    private roomId: string,
    private displayName: string,
    private onChange: (state: RoomConnectionState) => void,
  ) {
    socket.on('connect', this.join);
    socket.on('disconnect', this.disconnected);
    socket.on('connect_error', this.connectionError);
    socket.on('message:new', this.message);
    socket.on('participants:update', this.presence);
  }

  private update(patch: Partial<RoomConnectionState>): void {
    if (this.stopped) return;
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  start(): void {
    this.update({ status: 'connecting', error: null });
    if (this.socket.connected) this.join();
    else this.socket.connect();
  }

  retry(): void {
    this.update({ status: this.state.joinedOnce ? 'reconnecting' : 'connecting', error: null });
    if (this.socket.connected) this.join();
    else this.socket.connect();
  }

  private join = (): void => {
    const generation = ++this.generation;
    this.buffered = [];
    this.bufferedParticipants = null;
    this.update({ status: this.state.joinedOnce ? 'reconnecting' : 'connecting', error: null });
    const request: Promise<Ack<RoomSnapshot>> = this.socket.timeout(10_000).emitWithAck('room:join', {
      roomId: this.roomId, displayName: this.displayName,
    });
    void request.then((ack) => {
      if (this.stopped || generation !== this.generation) return;
      if (!ack.ok) throw new Error(ack.error);
      this.update({
        status: 'joined', joinedOnce: true, error: null,
        messages: mergeMessages(ack.data.messages, this.buffered),
        participants: this.bufferedParticipants ?? ack.data.participants,
      });
      this.buffered = [];
      this.bufferedParticipants = null;
    }).catch((error: unknown) => {
      if (this.stopped || generation !== this.generation) return;
      this.update({ status: 'error', error: error instanceof Error ? error.message : 'Unable to join the room.' });
    });
  };

  private disconnected = (): void => {
    ++this.generation;
    this.buffered = [];
    this.bufferedParticipants = null;
    this.update({
      status: 'reconnecting', error: null,
      participants: this.state.participants.map((participant) => ({ ...participant, online: false })),
    });
  };

  private connectionError = (error: Error): void => {
    this.update({ status: 'error', error: `Could not connect: ${error.message}` });
  };

  private message = (message: Message): void => {
    if (message.roomId !== this.roomId) return;
    if (this.state.status !== 'joined') this.buffered.push(message);
    else this.update({ messages: mergeMessages(this.state.messages, [message]) });
  };

  private presence = (event: { roomId: string; participants: Participant[] }): void => {
    if (event.roomId !== this.roomId) return;
    if (this.state.status !== 'joined') this.bufferedParticipants = event.participants;
    else this.update({ participants: event.participants });
  };

  async send(input: SendMessageRequest): Promise<Message> {
    if (this.state.status !== 'joined' || !this.socket.connected || input.roomId !== this.roomId) {
      throw new Error('Reconnect to the room before sending.');
    }
    const ack: Ack<Message> = await this.socket.timeout(10_000).emitWithAck('message:send', input);
    if (!ack.ok) throw new Error(ack.error);
    this.update({ messages: mergeMessages(this.state.messages, [ack.data]) });
    return ack.data;
  }

  stop(): void {
    this.stopped = true;
    ++this.generation;
    this.socket.off('connect', this.join);
    this.socket.off('disconnect', this.disconnected);
    this.socket.off('connect_error', this.connectionError);
    this.socket.off('message:new', this.message);
    this.socket.off('participants:update', this.presence);
    this.socket.disconnect();
  }
}
