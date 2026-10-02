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
npm run build
```

The 11 realtime tests use actual WebSocket/polling connections and an in-memory
implementation of the database interface. The restart test reuses that store;
SQLite persistence itself remains Arnav's responsibility.

Bhavya's root `npm test` script currently only discovers `tests/*.test.ts`.
It needs to include this module's tests during integration. Its scaffold
transport test expects an unauthenticated connection and placeholder join error;
that expectation must be updated for verified sessions. The database and HTTP
session routes on this branch remain scaffold stubs, so the full app is waiting
on Arnav's module and Bhavya's client integration.
