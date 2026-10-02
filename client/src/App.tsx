import { useState } from 'react';
import { JoinRoomForm, MessageComposer, MessageList, ParticipantSidebar } from './components';
export default function App() {
  const [displayName, setDisplayName] = useState('');
  const [draft, setDraft] = useState('');
  const match = /^\/room\/([^/]+)\/?$/.exec(window.location.pathname);
  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
    <h1 className="text-2xl font-semibold">Study Room</h1>
    <p className="my-4 text-slate-400">Scaffold ready. Room creation, sessions, chat and presence await feature integration.</p>
    {match && <p>Room ID: {match[1]}</p>}
    <JoinRoomForm displayName={displayName} onDisplayNameChange={setDisplayName}
      onJoin={() => {}} joining={false} error="Joining is not implemented yet." />
    <div className="mt-6 grid gap-6 md:grid-cols-[1fr_16rem]">
      <section aria-label="Chat">
        <MessageList messages={[]} currentUserId={null} loading={false} error={null} />
        <MessageComposer value={draft} onChange={setDraft} onSend={() => {}}
          disabled sending={false} error={null} />
      </section>
      <ParticipantSidebar participants={[]} currentUserId={null} status="idle" />
    </div>
  </main>;
}
