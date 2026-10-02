import { Router } from 'express';
import type { ServerDependencies } from '../../../shared/database.js';
/** Arnav implements sessions and room endpoints; no unauthenticated identity fallback. */
export function createApiRouter(_dependencies: ServerDependencies): Router {
  const router = Router();
  const pending = (_req: unknown, res: import('express').Response) => {
    res.status(501).json({ error: 'Session and room endpoints are not implemented yet.' });
  };
  router.post('/session', pending);
  router.post('/rooms', pending);
  router.get('/rooms/:roomId', pending);
  return router;
}
