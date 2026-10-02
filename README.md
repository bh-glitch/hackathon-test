# Study Room — four-person hackathon plan

## Product

A minimal dark group chat. People open a room link, enter a display name, and chat live. Most of the screen is chat; the right sidebar shows members with green online and grey offline dots. History survives refreshes and server restarts. No AI chatbot, uploads, voice, or video in the first version.

Confirmed product decisions: one shared app backed by one server and one database; anyone using the app can create a room and share its link; participants enter a display name with no account or signup. Every computer can create and join rooms through this shared app. Bhavya's computer is the proposed server host, not a requirement that only Bhavya can create rooms. Another computer can run the shared server if the team chooses it.

Confirmed MVP decisions for this test run:

- Retain disconnected members in the sidebar with grey offline dots.
- Limit access to devices on the same local Wi-Fi.
- Display names must be 1–40 characters after trimming.
- Use Node.js 22 on all four computers.

## Stack and runtime

React, Vite, TypeScript, Tailwind CSS; Node.js, Express, Socket.IO, SQLite. Use npm and Node.js 22 on all four computers (minimum 22.12.0 for this scaffold). No cloud services are required for the local demo.

GitHub shares source code. It does not run the backend or synchronize chat messages. During development, each person can run an independent local server. During the four-computer demo, everyone uses ONE server and its ONE SQLite database on Bhavya's computer. Do not put the database file in Git or run it from a shared network folder.

## Ownership

| Person | Branch | Responsibility | Owned files |
|---|---|---|---|
| Bhavya | bhavya/setup-integration | Scaffold, shared interfaces, app wiring, start scripts, integration and final demo | Root configuration and lockfile, shared/, client/src/App.tsx, client/src/lib/, server/src/index.ts |
| Ishan | ishan/chat-ui | Dark layout, message list, composer, participant sidebar, loading/error states | client/src/components/, client/src/styles/ |
| Vansh | vansh/realtime | Socket.IO room joining, live messaging, presence and reconnect handling | server/src/realtime/ |
| Arnav | arnav/database | SQLite schema, room endpoints, message/member persistence and database tests | server/src/db/, server/src/routes/ |

Bhavya is the proposed integration lead and demo host. Swap names if preferred, but keep one owner per area. Tests sit next to the owning module; Bhavya owns cross-module integration tests.

Only Bhavya edits shared types, dependency manifests, lockfiles and shared configuration. Other agents request changes in their GitHub issue. This avoids four agents independently changing the foundation.

## Scaffold quick start and handoff

The confirmed runtime is **Node 22.x on all four computers, minimum 22.12.0**
for this scaffold. Bhavya tested on 22.12.0 (`.nvmrc` pins that version);
use a current patched Node 22 release within the confirmed major version.
Run all commands from the repository root:

```sh
npm ci
cp .env.example .env  # optional; defaults work without this file
npm run dev          # Express/Socket.IO :3000, Vite :5173
npm run check        # typecheck, integration smoke tests, production build
npm run build
npm start            # one Express/Socket.IO server serving dist/client on :3000
```

Development: open `http://localhost:5173`. Vite proxies `/api` and `/socket.io`
(including WebSocket upgrades) to `API_PROXY_TARGET`, defaulting to
`http://127.0.0.1:3000`. Clients use relative URLs, including on other devices.
Production: open `http://localhost:3000`; `/room/:roomId` serves the SPA.
`HOST`, `PORT`, and `DATABASE_PATH` are server settings in `.env.example`.
The host binding is configurable; listening on `0.0.0.0` alone does not establish
or test device-to-device Wi-Fi/firewall access. This test run is limited to
the same local Wi-Fi; access beyond that network is outside its scope.
`/api/health` reports `stage: scaffold` and does not claim that persistence or
chat is ready.

### Fixed handoff contracts

- `shared/types.ts`: data, HTTP payloads, acknowledgements, typed Socket.IO
  events and server-only socket identity. HTTP success bodies are plain
  `Room`/`SessionResponse`; HTTP failures use `{ error: string }` with a non-2xx
  status. Socket acknowledgements use `Ack<T>`.
- `shared/components.ts`: Ishan's four controlled component props. App owns
  the display name, draft, connection status and send/retry orchestration.
  `onJoin()` and `onSend()` are callbacks; errors arrive via props.
- `shared/database.ts`: Arnav's asynchronous `RoomDatabase` and `SessionStore`.
  `getRoom`/`getSession` return `null` when absent; failed operations reject.
  Database implementation generates IDs/timestamps. `saveMessage` returns the
  original message for a duplicate `(roomId, senderId, clientMessageId)`.
  Stored members contain no online flag. Session IDs are random credentials,
  distinct from public user IDs, persisted through server restarts.
- Arnav: replace `server/src/db/index.ts`'s `openDatabase(path): Database` and
  `server/src/routes/index.ts`'s `createApiRouter(dependencies): Router`.
  Route paths are relative to the `/api` mount. Add SQLite schema/migrations,
  persistent session verification and HttpOnly cookies, and database tests.
  The `better-sqlite3` dependency is pinned to tested version 12.4.1; version
  13.0.3 crashed when opening a database on Node 22.12.0 on this Mac.
  The stub creates no file/schema.
- Vansh: replace `server/src/realtime/index.ts`'s
  `initializeRealtime(io, dependencies): void`. Verify the cookie through
  `dependencies.sessions.getSession` before assigning `socket.data.userId`.
  Add membership validation, durable sends, deduplication and multi-tab
  presence. Retain saved members after disconnect or leave and emit them as
  offline once their last socket leaves. Trim display names and enforce the
  confirmed 1–40-character limit on the server. Use `SESSION_COOKIE_NAME`
  from the shared contract.
- Ishan: replace named exports in `client/src/components/` and styles in
  `client/src/styles/`. All four placeholders are wired into App, with joining
  and sending disabled until integration. Show retained offline members with
  grey dots and online members with green dots. Use the confirmed trimmed
  display-name limit for form feedback. Keep the exported props stable.
- Bhavya: after feature PRs, wire room creation, anonymous session bootstrap,
  joins/rejoins, buffered history merge, message retries and loading/error
  state in App/lib. No demo-ready chat flow exists in this scaffold.

All feature modules deliberately remain placeholders: HTTP feature routes
return 501, socket requests return failed acknowledgements, and the database
stub rejects. Production wiring, frontend assets and the transport run, but
sessions, rooms, messages, history and presence are **not implemented**.
The smoke tests cover that wiring and native SQLite availability, not feature
acceptance. The final four-device demo checklist remains outstanding.

The four MVP decisions above are confirmed; no clarification remains for
these handoffs. Their feature behavior remains for the assigned owners to
implement. The existing `PROPOSED_MAX_DISPLAY_NAME_LENGTH` export retains its
name for handoff compatibility, but its value of 40 is now the confirmed limit.

## Before parallel work

Bhavya's agent first creates and merges a small scaffold containing:

- The folder structure above and working development/build commands.
- shared/types.ts defining the data and event contracts below.
- Exported component placeholders: MessageList, MessageComposer, ParticipantSidebar and JoinRoomForm. Fix their props in this first commit.
- A database interface and placeholder room router/realtime initializer, with agreed signatures.
- A Vite proxy for /api and /socket.io so the browser uses its current origin; production Express serves the built frontend and Socket.IO on port 3000.
- .gitignore excluding node_modules, .env and SQLite files; .env.example with non-secret examples.

The other three agents begin implementation after pulling this scaffold. They can read the plan and prepare beforehand. Agree on interfaces before coding in parallel.

## Shared contract

All timestamps are server-generated UTC ISO strings. Room IDs and user IDs are opaque IDs; display names are labels, not identity.

```ts
type Room = { id: string; name: string; createdAt: string };
type Message = {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
};
type Participant = { userId: string; displayName: string; online: boolean };
type RoomSnapshot = {
  room: Room;
  messages: Message[];
  participants: Participant[];
};
type Ack<T> = { ok: true; data: T } | { ok: false; error: string };
```

HTTP:

- POST /api/session: creates an opaque anonymous session cookie or restores an existing session. Returns userId. Keep the cookie HttpOnly and verify it on HTTP and Socket.IO requests. No signup form is required.
- POST /api/rooms with { name }: creates a room and returns Room; frontend builds /room/:roomId as its share link.
- GET /api/rooms/:roomId: returns Room or 404.

Socket.IO, with acknowledgements for client requests:

- Client sends room:join { roomId, displayName }; ack returns Ack<RoomSnapshot>.
- Client sends message:send { roomId, clientMessageId, text }; ack returns Ack<Message> only after saving succeeds.
- Server emits message:new with Message to that room after saving.
- Server emits participants:update with { roomId, participants: Participant[] }.
- Client sends room:leave { roomId }; ack returns Ack<null>.

The server derives senderId from the session, checks room membership, validates inputs and limits text to 2,000 characters. Never trust a sender identity supplied in message payloads. Display names must be 1–40 characters after trimming; enforce this on the server.

Store rooms, room_members and messages in SQLite. Store clientMessageId and enforce uniqueness per sender and room, so retrying the same send returns the original saved message rather than creating a duplicate. Database code exports createRoom, getRoom, upsertMember, listMembers, listMessages and saveMessage; Bhavya fixes their TypeScript signatures in the scaffold. Online state lives in the realtime layer, not a stale database boolean.

## Joining and reconnecting

Register browser event listeners first. The server attaches the socket to the room before fetching history. While waiting for the join acknowledgement, the browser buffers incoming events; it then merges the snapshot and buffered messages by message ID. Sort messages by server time with ID as a tie-breaker. This prevents gaps and duplicates during joining.

On reconnect, join again and reload history. Show a reconnecting indicator and disable sending until joined; retain the draft. For this small MVP, load all room history; pagination is a later improvement.

Track sockets per user per room. A user is online while at least one socket remains connected, including multiple tabs. On disconnect or explicit leave, update presence. Keep saved members visible with grey dots when offline. Abrupt network loss may take time to detect. Presence resets when the server restarts and rebuilds as users reconnect.

## GitHub workflow

1. Create one repository and invite all four people as collaborators. Copy this README to its root.
2. Create one issue per assignment, including owned files and acceptance criteria.
3. Everyone clones the same repository and opens their own clone in VS Code.
4. Each agent works on its assigned branch and owned files. Commit small, complete changes.
5. Push the branch and open a pull request to main. Include what changed, how it was tested and unresolved dependencies.
6. Bhavya reviews and merges compatible changes one at a time, coordinating interface changes with their owners.
7. Everyone pulls the updated main before starting the next task. Sync main into long-running branches as needed; do not overwrite another person's work or force-push shared branches.

A practical order: scaffold → database and UI work in parallel with realtime work → merge database → merge realtime → merge UI → app integration → four-device test. Realtime can develop against the agreed database interface while database work is in progress.

Codex sessions on separate computers do not automatically share their chats or plans. Use this README, shared types, GitHub issues and pull requests as their common memory. Update the issue when blocked or when a contract change is needed. The coders handle account sign-in, cross-machine communication and any required permissions.

## Prompt for each agent

Replace the placeholders with the person's assignment from the table:

> Read README.md and any applicable AGENTS.md before editing. You are working as [NAME] on [BRANCH]. Implement [RESPONSIBILITY] using the agreed shared interfaces. Stay within your owned files. Request changes to shared types, dependencies or other owners' files through the task issue rather than making conflicting edits. Run checks appropriate to your changes. Commit your work and, if GitHub access is authorized and available, push and open a pull request. Report changed files, test results, dependencies and blockers. Do not merge into main. Do not redesign the stack or add features beyond the MVP.

Bhavya's initial agent task is to create the scaffold and interfaces; its next task is integration after the feature pull requests are ready. Share each assignment explicitly; do not ask four agents to independently build the whole app.

## Final demo checklist

- Use Node.js 22 on all four computers and connect them to the same local Wi-Fi.
- Build and run the combined app on Bhavya's computer, listening on 0.0.0.0:3000. Permit access through the host firewall.
- Other devices open http://HOST_LOCAL_IP:3000/room/ROOM_ID. They must not use localhost, which points at their own computer.
- Confirm the Wi-Fi allows device-to-device communication; guest networks may block it.
- A sends a message; B, C and D receive it without refresh.
- B joins late and sees earlier messages. Refresh preserves identity and history.
- Disconnect one device: its member turns grey after disconnect detection. Reconnect: it turns green and catches up.
- Open two tabs as the same user; closing one does not mark the user offline.
- Restart the server: saved rooms/messages survive and clients rejoin.
- Verify room isolation, failed-send feedback and retry deduplication.

The host must remain running. Local app software has no licensing/cloud hosting fees; AI coding subscriptions, existing hardware and connectivity are separate costs.
