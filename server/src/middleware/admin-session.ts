import { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import { randomBytes, timingSafeEqual } from 'crypto';

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  return (v == null || v === '') ? (fallback || '') : v;
}

// Resolve the secret used to sign/verify the admin-session JWT.
// Order (unchanged): ADMIN_SESSION_SECRET > JWT_SECRET > ADMIN_API_KEY.
// In production, warn ONCE if no dedicated secret is configured, or if it is
// reused from ADMIN_API_KEY — leaking one credential should not compromise the
// other. Non-blocking: the server keeps working with the fallback.
let warnedAboutAdminSessionSecret = false;
export function resolveAdminSessionSecret(): string {
  const dedicated = getEnv('ADMIN_SESSION_SECRET');
  const apiKey = getEnv('ADMIN_API_KEY');
  const secret = dedicated || getEnv('JWT_SECRET') || apiKey;

  if (process.env.NODE_ENV === 'production' && !warnedAboutAdminSessionSecret) {
    if (!dedicated) {
      // eslint-disable-next-line no-console
      console.warn(
        '[security] ADMIN_SESSION_SECRET is not set in production; falling back to ' +
          'JWT_SECRET/ADMIN_API_KEY. Set a dedicated ADMIN_SESSION_SECRET (distinct from ' +
          'ADMIN_API_KEY) to isolate admin-session signing.',
      );
      warnedAboutAdminSessionSecret = true;
    } else if (apiKey && dedicated === apiKey) {
      // eslint-disable-next-line no-console
      console.warn(
        '[security] ADMIN_SESSION_SECRET equals ADMIN_API_KEY in production; use a distinct value.',
      );
      warnedAboutAdminSessionSecret = true;
    }
  }

  return secret;
}

// Generate a secure CSRF token
export function generateCSRFToken(): string {
  return randomBytes(32).toString('hex');
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const parts = header.split(';');
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i === -1) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = '';
    }
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

export async function verifyAdminSessionFromRequest(req: Request): Promise<boolean> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['admin_session'];
  if (!token) return false;

  const secretRaw = resolveAdminSessionSecret();
  if (!secretRaw) return false;

  try {
    const secret = new TextEncoder().encode(secretRaw);
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (payload?.typ !== 'admin') return false;
    return true;
  } catch {
    return false;
  }
}

export function requireAdminSession() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ok = await verifyAdminSessionFromRequest(req);
    if (!ok) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  };
}

// CSRF Protection: Double-submit cookie pattern
// Requires that for POST/PUT/DELETE requests, the X-CSRF-Token header matches the csrf_token cookie
export function requireCSRF() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only check CSRF on state-changing methods
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
      return next();
    }

    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies['csrf_token'];
    const headerToken =
      typeof req.headers['x-csrf-token'] === 'string'
        ? req.headers['x-csrf-token']
        : '';

    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }

    return next();
  };
}
