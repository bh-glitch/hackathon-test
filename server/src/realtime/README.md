# Realtime handoff

`initializeRealtime(io, { database, sessions })` implements the fixed shared
contracts. No dependency or shared-type changes are required.

- Bootstrap `/api/session` before connecting. Socket middleware verifies
  `SESSION_COOKIE_NAME` with `sessions.getSession`; missing/invalid cookies
  produce `connect_error`. The credential is separate from the public user ID.
- Register client listeners before joining. Join attaches the transport to the
  room before reading history and returns all messages plus saved members with
  current presence. Buffer incoming events until the acknowledgement, then merge
  messages by ID. Room operations run in order within each room.
- Send requires this socket to have joined, plus saved membership. Sender identity
  comes from the verified session and the saved display name. Names are trimmed
  to 1–40 characters; messages are nonblank, at most 2,000 characters before
  trimming, and stored trimmed.
- `saveMessage` must atomically deduplicate `(roomId, senderId, clientMessageId)`.
  Success is acknowledged and broadcast only after saving. A retry broadcasts
  the original message again; clients merge by message ID.
- Presence counts sockets per user per room. Leave/disconnect never deletes
  members. A user stays online until their last socket leaves. Presence resets
  on server restart; snapshots include retained members as offline.
- Reconnect creates an authenticated socket that must join again. The client
  owns reconnect indicators, disabling sends until joined, draft retention,
  buffering, and retries with the original client message ID.

Run from the repository root on Node 22 (minimum 22.12.0):

```sh
node --import tsx --test server/src/realtime/index.test.ts
node --import tsx --test client/src/lib/room-connection.test.ts
npm run build
```

The 11 realtime tests use actual WebSocket/polling connections and an in-memory
implementation of the database interface. The restart test reuses that store;
SQLite persistence itself remains Arnav's responsibility.

The client now connects the existing UI through `App.tsx` and
`client/src/lib/room-connection.ts`: room creation, session bootstrap, joins,
live events, reconnect/rejoin, snapshot buffering, draft retention, and retries.
Display names are saved per room and verified user ID so refresh can rejoin.
Client message IDs use `crypto.getRandomValues`, which works on HTTP Wi-Fi URLs.
Arnav's database and routes are included in the branch. The root smoke test now
exercises actual session, room and message persistence rather than placeholders.

Five client controller tests cover event buffering, ordered message merging,
stale acknowledgements, reconnects, retries and listener cleanup. The root
`npm test` script still only discovers `tests/*.test.ts`; run all feature tests
explicitly until Bhavya updates shared test configuration:

```sh
node --import tsx --test tests/*.test.ts server/src/db/*.test.ts server/src/routes/*.test.ts server/src/realtime/*.test.ts client/src/lib/*.test.ts
```

Browser verification covered independent users chatting, refresh, multiple tabs,
offline presence, room isolation, failed saves, lost acknowledgements, and server
restart with persistent SQLite history and draft recovery. The four-device
Wi-Fi/firewall demo remains a separate acceptance check.
