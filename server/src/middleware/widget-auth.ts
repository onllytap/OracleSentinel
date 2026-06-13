import { Request, Response, NextFunction } from 'express';
import { SignJWT, jwtVerify } from 'jose';

type WidgetTokenPayload = {
  tenant_id: string;
  widget_id: string;
  scopes: string[];
  origin?: string;
};

type VerifiedWidgetAuth = {
  tenantId: string;
  widgetId: string;
  scopes: string[];
  origin?: string;
};

declare global {
  namespace Express {
    interface Request {
      widgetAuth?: VerifiedWidgetAuth;
    }
  }
}

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  return (v == null || v === '') ? (fallback || '') : v;
}

function parseAllowedOrigins(): string[] {
  const raw = getEnv('WIDGET_ALLOWED_ORIGINS', 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173');
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseWidgetTenants(): Record<string, string> {
  const rawEnv = getEnv('WIDGET_TENANT_MAP', 'default:default');
  const raw = rawEnv.trim().replace(/^['"]|['"]$/g, '');
  const map: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const [widgetId, tenantId] = trimmed.split(':').map((s) => s.trim());
    if (widgetId && tenantId) map[widgetId] = tenantId;
  }
  return map;
}

export function getRequestOrigin(req: Request): string | null {
  const headerOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
  if (headerOrigin) return headerOrigin;

  const referer = typeof req.headers.referer === 'string' ? req.headers.referer : null;
  if (!referer) return null;

  try {
    const url = new URL(referer);
    return url.origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin: string): boolean {
  const allowlist = parseAllowedOrigins();
  return allowlist.includes(origin);
}

function getJwtKey(): Uint8Array {
  const secret = getEnv('JWT_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long');
  }
  return new TextEncoder().encode(secret);
}

export async function issueWidgetToken(params: {
  widgetId: string;
  tenantId: string;
  scopes: string[];
  origin?: string;
}): Promise<string> {
  const alg = getEnv('JWT_ALG', 'HS256');
  if (alg !== 'HS256') {
    throw new Error(`Unsupported JWT_ALG: ${alg}`);
  }

  const issuer = getEnv('JWT_ISSUER', 'your-company');
  const audience = getEnv('JWT_AUDIENCE', 'chat-widget');
  const ttlSeconds = parseInt(getEnv('JWT_TTL_SECONDS', '1200'), 10);

  const now = Math.floor(Date.now() / 1000);
  const payload: WidgetTokenPayload = {
    tenant_id: params.tenantId,
    widget_id: params.widgetId,
    scopes: params.scopes,
    origin: params.origin,
  };

  return await new SignJWT(payload)
    .setProtectedHeader({ alg })
    .setIssuedAt(now)
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(now + Math.max(60, ttlSeconds))
    .sign(getJwtKey());
}

export function widgetAuthHandler() {
  return async (req: Request, res: Response) => {
    try {
      const widgetId = typeof req.query.widget_id === 'string' ? req.query.widget_id : '';
      if (!widgetId) {
        console.warn('[WidgetAuth] Missing widget_id');
        return res.status(400).json({ error: 'widget_id requis' });
      }

      const origin = getRequestOrigin(req);
      if (!origin || !isAllowedOrigin(origin)) {
        console.warn('[WidgetAuth] Origin not allowed', { origin, widgetId });
        return res.status(403).json({ error: 'Origin non autorisé' });
      }

      const widgetTenants = parseWidgetTenants();
      const tenantId = widgetTenants[widgetId];
      if (!tenantId) {
        console.warn('[WidgetAuth] Unknown widget_id', {
          origin,
          widgetId,
          configuredWidgetIds: Object.keys(widgetTenants),
        });
        return res.status(403).json({ error: 'widget_id non autorisé' });
      }

      const token = await issueWidgetToken({
        widgetId,
        tenantId,
        scopes: ['chat:write'],
        origin,
      });

      res.setHeader('Cache-Control', 'no-store');
      return res.json({ token });
    } catch (error) {
      console.error('Error in widgetAuthHandler:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export function requireWidgetAuth(requiredScopes: string[] = []) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (!m) {
        console.warn('[WidgetAuth] Missing bearer token', { path: req.path, method: req.method });
        return res.status(401).json({ error: 'Missing bearer token' });
      }

      const issuer = getEnv('JWT_ISSUER', 'your-company');
      const audience = getEnv('JWT_AUDIENCE', 'chat-widget');
      const { payload } = await jwtVerify(m[1], getJwtKey(), { issuer, audience });

      const widgetId = typeof payload.widget_id === 'string' ? payload.widget_id : '';
      const tenantId = typeof payload.tenant_id === 'string' ? payload.tenant_id : '';
      const scopes = Array.isArray(payload.scopes) ? payload.scopes.filter((s: unknown): s is string => typeof s === 'string') : [];
      const tokenOrigin = typeof payload.origin === 'string' ? payload.origin : undefined;

      if (!widgetId || !tenantId) {
        return res.status(401).json({ error: 'Invalid token payload' });
      }

      const requestOrigin = getRequestOrigin(req);
      if (tokenOrigin) {
        if (!requestOrigin) {
          console.warn('[WidgetAuth] Missing request origin', { widgetId, tenantId, path: req.path, method: req.method });
          return res.status(403).json({ error: 'Origin missing' });
        }
        if (tokenOrigin !== requestOrigin) {
          console.warn('[WidgetAuth] Origin mismatch', { tokenOrigin, requestOrigin, widgetId, tenantId, path: req.path });
          return res.status(403).json({ error: 'Origin mismatch' });
        }
      }

      for (const scope of requiredScopes) {
        if (!scopes.includes(scope)) {
          console.warn('[WidgetAuth] Missing scope', { required: scope, scopes, widgetId, tenantId, path: req.path });
          return res.status(403).json({ error: 'Insufficient scope' });
        }
      }

      req.widgetAuth = {
        tenantId,
        widgetId,
        scopes,
        origin: tokenOrigin,
      };

      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('exp') || message.toLowerCase().includes('expired')) {
        console.warn('[WidgetAuth] Token expired', { path: req.path, method: req.method });
      } else {
        console.warn('[WidgetAuth] Invalid token', { path: req.path, method: req.method, error: message });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}
