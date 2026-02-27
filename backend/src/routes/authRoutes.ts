import type { Express, Request, Response } from 'express';
import { prisma } from '../db/prismaClient.js';
import { generateToken } from '../auth/jwt.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { RegisterSchema, LoginSchema } from '../validation/schemas.js';
import { v4 as uuidv4 } from 'uuid';

const HAS_DATABASE = Boolean(process.env.DATABASE_URL);

function sendError(res: Response, status: number, code: string, message: string, details: unknown = null): void {
  res.status(status).json({ error: { code, message, details } });
}

export function setupAuthRoutes(app: Express): void {
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.issues);
      return;
    }

    const { email, password, name } = parsed.data;

    if (!HAS_DATABASE) {
      const user = { id: `demo-${email}`, email, name, role: 'OWNER' as const };
      const token = generateToken({ userId: user.id, role: user.role });
      res.status(201).json({ user, token, mode: 'demo-no-db' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      sendError(res, 409, 'EMAIL_TAKEN', 'Email is already registered');
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { id: uuidv4(), email, name, passwordHash, role: 'OWNER' },
    });

    const token = generateToken({ userId: user.id, role: user.role });
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.issues);
      return;
    }

    const { email, password } = parsed.data;

    if (!HAS_DATABASE) {
      // In no-DB demo mode, accept the supplied credentials and mint a token.
      // This preserves the frontend auth flow without requiring Postgres.
      const user = { id: `demo-${email}`, email, name: 'Demo User', role: 'OWNER' as const };
      const token = generateToken({ userId: user.id, role: user.role });
      res.json({ user, token, mode: 'demo-no-db' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      return;
    }

    const token = generateToken({ userId: user.id, role: user.role });
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  });
}
