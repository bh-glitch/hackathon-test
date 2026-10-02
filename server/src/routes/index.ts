import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AnonymousSession, ServerDependencies } from '../../../shared/database.js';
import { SESSION_COOKIE_NAME } from '../../../shared/types.js';

const sessionCookieOptions = {
  httpOnly: true,
  maxAge: 365 * 24 * 60 * 60 * 1_000,
  sameSite: 'lax' as const,
  path: '/',
};

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;

  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

async function getVerifiedSession(
  request: Request,
  dependencies: ServerDependencies,
): Promise<AnonymousSession | null> {
  const sessionId = readCookie(request, SESSION_COOKIE_NAME);
  return sessionId ? dependencies.sessions.getSession(sessionId) : null;
}

/** Create the anonymous-session and room HTTP API mounted beneath `/api`. */
export function createApiRouter(dependencies: ServerDependencies): Router {
  const router = Router();

  router.post('/session', async (request, response) => {
    const existing = await getVerifiedSession(request, dependencies);
    const session = existing ?? await dependencies.sessions.createSession();
    response.cookie(SESSION_COOKIE_NAME, session.sessionId, sessionCookieOptions);
    response.json({ userId: session.userId });
  });

  router.post('/rooms', async (request, response) => {
    const session = await getVerifiedSession(request, dependencies);
    if (!session) {
      response.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    if (!name) {
      response.status(400).json({ error: 'Room name is required.' });
      return;
    }

    response.status(201).json(await dependencies.database.createRoom({ name }));
  });

  router.get('/rooms/:roomId', async (request: Request, response: Response) => {
    const roomId = Array.isArray(request.params.roomId)
      ? request.params.roomId[0]
      : request.params.roomId;
    const room = await dependencies.database.getRoom(roomId);
    if (!room) {
      response.status(404).json({ error: 'Room not found.' });
      return;
    }
    response.json(room);
  });

  return router;
}
