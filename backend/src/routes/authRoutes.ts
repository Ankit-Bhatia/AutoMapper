import type { Express, Request, Response } from 'express';
import type { CookieOptions } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db/prismaClient.js';
import { authMiddleware } from '../auth/authMiddleware.js';
import { generateToken } from '../auth/jwt.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { RegisterSchema, LoginSchema } from '../validation/schemas.js';
import { sendHttpError } from '../utils/httpErrors.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

interface AuthUserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  passwordHash: string;
  organisationId?: string | null;
  organisationSlug?: string | null;
}

interface AuthUserResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  orgSlug?: string;
}

const loginAttemptsByIp = new Map<string, number[]>();
let noDbUser: AuthUserRecord | null = null;

export function __resetAuthStateForTests(): void {
  loginAttemptsByIp.clear();
  noDbUser = null;
}

function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPublicUser(user: AuthUserRecord): AuthUserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    orgSlug: user.organisationSlug ?? undefined,
  };
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function pruneAndReadAttempts(ip: string, now: number): number[] {
  const attempts = loginAttemptsByIp.get(ip) ?? [];
  const fresh = attempts.filter((ts) => now - ts <= LOGIN_WINDOW_MS);
  if (fresh.length > 0) {
    loginAttemptsByIp.set(ip, fresh);
  } else {
    loginAttemptsByIp.delete(ip);
  }
  return fresh;
}

function isLoginRateLimited(ip: string): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const attempts = pruneAndReadAttempts(ip, now);
  if (attempts.length < LOGIN_MAX_ATTEMPTS) {
    return { limited: false, retryAfterSeconds: 0 };
  }

  const oldest = attempts[0] ?? now;
  const retryAfterMs = Math.max(1000, LOGIN_WINDOW_MS - (now - oldest));
  return {
    limited: true,
    retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
  };
}

function markLoginFailure(ip: string): void {
  const now = Date.now();
  const attempts = pruneAndReadAttempts(ip, now);
  attempts.push(now);
  loginAttemptsByIp.set(ip, attempts);
}

function clearLoginFailures(ip: string): void {
  loginAttemptsByIp.delete(ip);
}

async function getUserCount(): Promise<number> {
  if (hasDatabase()) {
    return prisma.user.count();
  }
  return noDbUser ? 1 : 0;
}

async function getUserByEmail(email: string): Promise<AuthUserRecord | null> {
  const normalized = normalizeEmail(email);
  if (hasDatabase()) {
    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      passwordHash: user.passwordHash,
      organisationId: user.organisationId,
      organisationSlug: user.organisationId
        ? (await prisma.organisation.findUnique({
            where: { id: user.organisationId },
            select: { slug: true },
          }))?.slug ?? null
        : null,
    };
  }

  if (!noDbUser || noDbUser.email !== normalized) {
    return null;
  }
  return noDbUser;
}

async function getUserById(id: string): Promise<AuthUserRecord | null> {
  if (hasDatabase()) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      passwordHash: user.passwordHash,
      organisationId: user.organisationId,
      organisationSlug: user.organisationId
        ? (await prisma.organisation.findUnique({
            where: { id: user.organisationId },
            select: { slug: true },
          }))?.slug ?? null
        : null,
    };
  }

  if (!noDbUser || noDbUser.id !== id) {
    return null;
  }
  return noDbUser;
}

async function createInitialUser(input: { email: string; password: string; name: string }): Promise<AuthUserRecord> {
  const normalizedEmail = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  if (hasDatabase()) {
    const organisation = await prisma.organisation.upsert({
      where: { slug: 'default' },
      update: {},
      create: {
        id: uuidv4(),
        slug: 'default',
        name: 'Default Organisation',
      },
    });

    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        email: normalizedEmail,
        name: input.name,
        passwordHash,
        role: 'OWNER',
        organisationId: organisation.id,
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      passwordHash: user.passwordHash,
      organisationId: user.organisationId,
      organisationSlug: organisation.slug,
    };
  }

  const user: AuthUserRecord = {
    id: uuidv4(),
    email: normalizedEmail,
    name: input.name,
    role: 'OWNER',
    passwordHash,
    organisationId: null,
    organisationSlug: 'default',
  };
  noDbUser = user;
  return user;
}

function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  };
}

function clearSessionCookie(res: Response): void {
  res.clearCookie('session', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

function issueSession(res: Response, user: AuthUserRecord): void {
  const token = generateToken({ userId: user.id, email: user.email, role: user.role });
  res.cookie('session', token, sessionCookieOptions());
}

function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): void {
  sendHttpError(req, res, status, code, message, details, 'auth');
}

async function handleSetup(req: Request, res: Response): Promise<void> {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.issues);
    return;
  }

  const userCount = await getUserCount();
  if (userCount > 0) {
    sendError(req, res, 409, 'ALREADY_INITIALIZED', 'Initial setup already completed');
    return;
  }

  const user = await createInitialUser(parsed.data);
  issueSession(res, user);
  res.status(201).json({
    user: toPublicUser(user),
  });
}

export function setupAuthRoutes(app: Express): void {
  // Public helper used by frontend to determine whether setup is required.
  app.get('/api/auth/setup-status', async (_req: Request, res: Response) => {
    const requiresSetup = (await getUserCount()) === 0;
    res.json({ requiresSetup });
  });

  // First-time setup route.
  app.post('/api/auth/setup', async (req: Request, res: Response) => {
    await handleSetup(req, res);
  });

  // Backward-compatible alias to keep older clients functional.
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    await handleSetup(req, res);
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const clientIp = getClientIp(req);
    const rateLimit = isLoginRateLimited(clientIp);
    if (rateLimit.limited) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      sendError(req, res, 429, 'RATE_LIMITED', 'Too many login attempts. Please try again later.');
      return;
    }

    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(req, res, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.issues);
      return;
    }

    const userCount = await getUserCount();
    if (userCount === 0) {
      sendError(req, res, 409, 'SETUP_REQUIRED', 'Initial setup is required before login');
      return;
    }

    const user = await getUserByEmail(parsed.data.email);
    if (!user) {
      markLoginFailure(clientIp);
      sendError(req, res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      return;
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      markLoginFailure(clientIp);
      sendError(req, res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      return;
    }

    clearLoginFailures(clientIp);
    issueSession(res, user);

    res.json({
      user: toPublicUser(user),
    });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    clearSessionCookie(res);
    res.status(204).send();
  });

  app.get('/api/auth/me', authMiddleware, async (req: Request, res: Response) => {
    if (process.env.REQUIRE_AUTH === 'false') {
      res.json({
        user: {
          id: 'demo-admin',
          email: 'demo.admin@automapper.local',
          name: 'Demo Admin',
          role: 'ADMIN',
          orgSlug: 'default',
        },
      });
      return;
    }

    const userId = req.user?.userId;
    if (!userId) {
      sendError(req, res, 401, 'UNAUTHORIZED', 'User not authenticated');
      return;
    }

    const user = await getUserById(userId);
    if (!user) {
      sendError(req, res, 401, 'UNAUTHORIZED', 'Session is invalid');
      return;
    }

    res.json({ user: toPublicUser(user) });
  });
}
