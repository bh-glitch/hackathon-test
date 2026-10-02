import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { JoinRoomForm, MessageComposer, MessageList, ParticipantSidebar } from './components';
import { createRoom, createSession, getRoom } from './lib/api';
import { createRoomSocket } from './lib/socket';
import { createClientMessageId, initialRoomState, RoomConnection } from './lib/room-connection';
import { MAX_MESSAGE_LENGTH, PROPOSED_MAX_DISPLAY_NAME_LENGTH, type Room, type ConnectionStatus } from '../../shared/types';

function roomFromLocation(): string | null {
  const match = /^\/room\/([^/]+)\/?$/.exec(window.location.pathname);
  try { return match ? decodeURIComponent(match[1]) : null; }
  catch { return null; }
}

function savedName(roomId: string, userId: string): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(`study-room:${roomId}`) ?? 'null');
    return saved?.userId === userId && typeof saved.displayName === 'string'
      && saved.displayName.trim().length > 0 && saved.displayName.trim().length <= PROPOSED_MAX_DISPLAY_NAME_LENGTH
      ? saved.displayName.trim() : null;
  } catch { return null; }
}

const statusCopy: Record<ConnectionStatus, string> = {
  idle: 'Choose a display name to join', connecting: 'Joining room…', joined: 'Connected · Messages update live',
  reconnecting: 'Reconnecting… Your draft is saved', error: 'Connection needs attention',
};

export default function App() {
  const [roomId, setRoomId] = useState(roomFromLocation);
  const [room, setRoom] = useState<Room | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [draft, setDraft] = useState('');
  const [roomName, setRoomName] = useState('Study Room');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [chat, setChat] = useState(initialRoomState);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const connection = useRef<RoomConnection | null>(null);
  const draftRef = useRef('');
  const retryMessage = useRef<{ clientMessageId: string; text: string } | null>(null);
  const sendInFlight = useRef(false);
  const createInFlight = useRef(false);

  const openConnection = useCallback((id: string, name: string, identity: string) => {
    connection.current?.stop();
    const next = new RoomConnection(createRoomSocket(), id, name, (state) => {
      setChat(state);
      if (state.status === 'joined') {
        try { localStorage.setItem(`study-room:${id}`, JSON.stringify({ userId: identity, displayName: name })); }
        catch { /* Chat still works when local storage is unavailable. */ }
      }
    });
    connection.current = next;
    next.start();
  }, []);

  useEffect(() => {
    const navigate = () => setRoomId(roomFromLocation());
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);

  useEffect(() => {
    let active = true;
    setRoom(null);
    setUserId(null);
    setRoomError(null);
    setChat(initialRoomState());
    setSendError(null);
    setSending(false);
    sendInFlight.current = false;
    retryMessage.current = null;
    draftRef.current = '';
    setDraft('');
    setPreparing(Boolean(roomId));
    if (roomId) {
      void Promise.all([getRoom(roomId), createSession()]).then(([found, session]) => {
        if (!active) return;
        setRoom(found);
        setUserId(session.userId);
        setPreparing(false);
        const name = savedName(roomId, session.userId);
        if (name) {
          setDisplayName(name);
          openConnection(roomId, name, session.userId);
        }
      }).catch((error: unknown) => {
        if (!active) return;
        setPreparing(false);
        setRoomError(error instanceof Error ? error.message : 'Unable to load the room.');
      });
    }
    return () => {
      active = false;
      connection.current?.stop();
      connection.current = null;
    };
  }, [roomId, loadAttempt, openConnection]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createInFlight.current || !roomName.trim()) return;
    createInFlight.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      await createSession();
      const created = await createRoom({ name: roomName.trim() });
      window.history.pushState(null, '', `/room/${encodeURIComponent(created.id)}`);
      setRoomId(created.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Unable to create a room.');
    } finally {
      createInFlight.current = false;
      setCreating(false);
    }
  }

  function onJoin() {
    const name = displayName.trim();
    if (!roomId || !userId || preparing || !name || name.length > PROPOSED_MAX_DISPLAY_NAME_LENGTH) return;
    openConnection(roomId, name, userId);
  }

  function onDraftChange(value: string) {
    draftRef.current = value;
    setDraft(value);
    if (retryMessage.current?.text !== value) {
      retryMessage.current = null;
      setSendError(null);
    }
  }

  async function onSend() {
    const current = connection.current;
    const text = draftRef.current;
    if (!current || !roomId || chat.status !== 'joined' || sendInFlight.current || !text.trim() || text.length > MAX_MESSAGE_LENGTH) return;
    const pending = retryMessage.current ?? { clientMessageId: createClientMessageId(), text };
    retryMessage.current = pending;
    sendInFlight.current = true;
    setSending(true);
    setSendError(null);
    try {
      await current.send({ roomId, ...pending });
      if (connection.current !== current) return;
      retryMessage.current = null;
      if (draftRef.current === text) {
        draftRef.current = '';
        setDraft('');
      }
    } catch (error) {
      if (connection.current !== current) return;
      setSendError(error instanceof Error ? error.message : 'Unable to send your message.');
    } finally {
      if (connection.current === current) {
        sendInFlight.current = false;
        setSending(false);
      }
    }
  }

  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
    <h1 className="text-2xl font-semibold">Study Room</h1>
    <p className="my-4 text-slate-400" role="status"
      style={chat.status === 'reconnecting' || chat.status === 'error' ? { display: 'block' } : undefined}>
      {room ? `${room.name} · ${statusCopy[chat.status]}` : roomId ? 'Loading study room…' : 'Create a room and share its link with your study group.'}
    </p>
    {!roomId && <section className="join-card" aria-labelledby="create-heading">
      <div className="join-card__mark" aria-hidden="true">SR</div>
      <div className="join-card__copy">
        <p className="eyebrow">Study together</p>
        <h2 id="create-heading">Create a study room</h2>
        <p>Your group can join using the room link.</p>
      </div>
      <form className="join-form" onSubmit={(event) => { void onCreate(event); }}>
        <label htmlFor="room-name">Room name</label>
        <div className="join-form__controls">
          <input id="room-name" value={roomName} onChange={(event) => setRoomName(event.target.value)} disabled={creating} />
          <button type="submit" disabled={creating || !roomName.trim()}>{creating ? 'Creating…' : 'Create room'}</button>
        </div>
        {createError && <p className="inline-error" role="alert">{createError}</p>}
      </form>
    </section>}
    {roomError && <div role="alert" className="my-4 text-red-300">
      <p>{roomError}</p>
      <button type="button" className="mr-4 underline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button>
      <a href="/" className="underline">Create another room</a>
    </div>}
    {room && <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm text-slate-400">
      <a className="min-w-0 truncate text-blue-400 underline" aria-label="Room link" href={`/room/${encodeURIComponent(room.id)}`}>
        {window.location.origin}/room/{encodeURIComponent(room.id)}
      </a>
      <span>Share this link with your group</span>
      {chat.joinedOnce && chat.status === 'error' && <button type="button" className="text-blue-400 underline" onClick={() => connection.current?.retry()}>Reconnect</button>}
    </div>}
    {room && !chat.joinedOnce && <JoinRoomForm displayName={displayName} onDisplayNameChange={setDisplayName}
      onJoin={onJoin} joining={chat.status === 'connecting' || chat.status === 'reconnecting'} error={chat.error} />}
    {chat.joinedOnce && chat.error && <p className="inline-error my-2" role="alert">{chat.error}</p>}
    {roomId && !roomError && <div className="mt-6 grid gap-6 md:grid-cols-[1fr_16rem]">
      <section aria-label="Chat">
        <MessageList messages={chat.messages} currentUserId={userId}
          loading={preparing || (!chat.joinedOnce && (chat.status === 'connecting' || chat.status === 'reconnecting'))} error={chat.error} />
        <MessageComposer value={draft} onChange={onDraftChange} onSend={() => { void onSend(); }}
          disabled={chat.status !== 'joined'} sending={sending} error={sendError} />
      </section>
      <ParticipantSidebar participants={chat.participants} currentUserId={userId} status={chat.status} />
    </div>}
  </main>;
}
