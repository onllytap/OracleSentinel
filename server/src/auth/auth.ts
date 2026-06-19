// ============================================================================
// Better Auth — OracleSentinel multi-user / 2FA upgrade path for /priv
// ============================================================================
// Mirrors the proven configuration from the sibling Chatbot project.
//
// The single-super-admin gate (ADMIN_API_KEY -> admin_session cookie) already
// protects /priv today. This module promotes /priv to real multi-user auth
// with email+password, optional social login, and TOTP two-factor.
//
// To activate (one-time):
//   1. Ensure BETTER_AUTH_SECRET and DATABASE_URL are set in server/.env
//   2. Generate the auth tables:  npx @better-auth/cli migrate
//   3. The handler is mounted in index.ts at /api/auth/* (guarded so a missing
//      secret never breaks server startup).
// ============================================================================

import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { Pool } from "pg";

const connectionString =
  process.env.NEXT_PRIVATE_DATABASE_URL || process.env.DATABASE_URL;

const pool = new Pool({ connectionString });

export const auth = betterAuth({
  database: pool,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001",
  basePath: "/api/auth",
  // Never fall back to an empty secret — that would disable signing.
  secret: process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12, // command-center accounts: stronger floor than default
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },
  session: {
    expiresIn: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [twoFactor()],
  trustedOrigins: [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
    ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
  ],
  advanced: {
    cookiePrefix: "oraclesentinel",
  },
});

/** True only when the auth secret is present — used to guard mounting. */
export const isBetterAuthConfigured = Boolean(
  (process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET) && connectionString,
);
