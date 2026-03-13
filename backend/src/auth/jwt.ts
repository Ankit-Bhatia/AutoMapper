import jwt from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

const JWT_EXPIRY = '8h';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('JWT_SECRET is required when authentication is enabled');
  }
  return secret;
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (
      typeof decoded === 'object'
      && decoded !== null
      && 'userId' in decoded
      && 'email' in decoded
      && 'role' in decoded
    ) {
      return decoded as JwtPayload;
    }
    return null;
  } catch {
    return null;
  }
}
