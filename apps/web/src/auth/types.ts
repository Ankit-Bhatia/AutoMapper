export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  orgSlug?: string;
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'setup-required';

export interface AuthError {
  status: number;
  code: string;
  message: string;
}
