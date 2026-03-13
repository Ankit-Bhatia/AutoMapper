import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from './jwt.js';
import { sendHttpError } from '../utils/httpErrors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // If auth is disabled (e.g. local dev single-user mode), attach a synthetic user
  if (process.env.REQUIRE_AUTH === 'false') {
    req.user = { userId: 'demo-admin', email: 'demo.admin@automapper.local', role: 'ADMIN' };
    next();
    return;
  }

  const sessionCookie = typeof req.cookies?.session === 'string' ? req.cookies.session : null;
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : null;
  let token: string | null = null;

  if (sessionCookie) {
    token = sessionCookie;
  } else if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (queryToken) {
    // Backward compatibility for older clients passing access_token on SSE URLs.
    token = queryToken;
  } else {
    sendHttpError(
      req,
      res,
      401,
      'UNAUTHORIZED',
      'Missing session cookie',
      null,
      'auth',
    );
    return;
  }

  const payload = verifyToken(token);

  if (!payload) {
    sendHttpError(
      req,
      res,
      401,
      'UNAUTHORIZED',
      'Invalid or expired token',
      null,
      'auth',
    );
    return;
  }

  req.user = payload;
  next();
}
