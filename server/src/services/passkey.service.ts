// ============================================================================
// Passkey (WebAuthn / FIDO2) service for the Command Center login.
//
// Goal: let the super-admin log into the QG with a device passkey (e.g. a
// Google Pixel) instead of typing ADMIN_API_KEY. ADMIN_API_KEY stays as the
// break-glass fallback (POST /api/admin/session is untouched).
//
// Design notes:
//  - We use @simplewebauthn/server directly (the passkey plugin is NOT in the
//    better-auth core we run). This keeps the integration tiny and additive.
//  - We store ONLY public material in `admin_passkeys` (COSE public key +
//    metadata). Never a secret.
//  - The per-ceremony WebAuthn challenge is kept server-authoritative inside a
//    short-lived, signed (HS256) cookie token — stateless, no extra table. The
//    cookie is HttpOnly and set/cleared by the route layer.
//  - There is a single logical admin "user"; every enrolled device is a row in
//    admin_passkeys. Authentication accepts ANY registered credential.
// ============================================================================

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  WebAuthnCredential,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { SignJWT, jwtVerify } from "jose";
import { pool } from "../db/pool";
import { resolveAdminSessionSecret } from "../middleware/admin-session";

// ── Stable identity for the single super-admin "user" ───────────────────────
const ADMIN_USER_NAME = "oraclesentinel-admin";
const ADMIN_USER_DISPLAY = "OracleSentinel Admin";

// Challenge cookie lives ~5 min — enough to complete a ceremony, short enough
// to limit replay surface.
const CHALLENGE_TTL_SECONDS = 5 * 60;
export const PASSKEY_CHALLENGE_COOKIE = "pk_challenge";

type ChallengePurpose = "register" | "auth";

export interface PasskeyRow {
  credentialId: string;
  publicKey: string; // base64url of the COSE public key
  counter: number;
  transports: AuthenticatorTransportFuture[];
  deviceType: string | null;
  backedUp: boolean;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

// ── Config (env-overridable, safe prod/dev defaults) ────────────────────────

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Resolve the Relying Party config.
 *  - rpID must be a registrable suffix of the page origin's host. The QG is
 *    served at https://api.oraclesentinel.com/qg, so rpID `oraclesentinel.com`
 *    (the parent domain) is valid and lets the passkey work across subdomains.
 *  - origin is the exact page origin. Multiple origins are supported (CSV) so
 *    local dev works whether the QG is served by Express or the Vite dev server.
 */
export function getPasskeyConfig(): {
  rpName: string;
  rpID: string;
  origin: string | string[];
} {
  const rpName = process.env.PASSKEY_RP_NAME || "OracleSentinel";
  const rpID =
    process.env.PASSKEY_RP_ID || (isProduction() ? "oraclesentinel.com" : "localhost");

  const originEnv = (process.env.PASSKEY_ORIGIN || "").trim();
  let origin: string | string[];
  if (originEnv) {
    const list = originEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    origin = list.length === 1 ? list[0] : list;
  } else if (isProduction()) {
    origin = "https://api.oraclesentinel.com";
  } else {
    // Local dev: the QG may be served by Vite (port 3000) or by Express (3001);
    // 4173 is Vite's preview server. rpID is "localhost" for all of these.
    origin = [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:4173",
    ];
  }

  return { rpName, rpID, origin };
}

// ── Signed challenge cookie token ───────────────────────────────────────────

export async function signChallengeToken(
  challenge: string,
  purpose: ChallengePurpose,
): Promise<string> {
  const secret = new TextEncoder().encode(resolveAdminSessionSecret());
  return await new SignJWT({ ch: challenge, purpose, typ: "pk-challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(secret);
}

/** Returns the challenge string if the token is valid for `purpose`, else null. */
export async function verifyChallengeToken(
  token: string,
  purpose: ChallengePurpose,
): Promise<string | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(resolveAdminSessionSecret());
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (payload?.typ !== "pk-challenge") return null;
    if (payload?.purpose !== purpose) return null;
    const ch = payload?.ch;
    return typeof ch === "string" && ch.length > 0 ? ch : null;
  } catch {
    return null;
  }
}

// ── DB access ───────────────────────────────────────────────────────────────

function mapRow(r: any): PasskeyRow {
  return {
    credentialId: r.credential_id,
    publicKey: r.public_key,
    counter: typeof r.counter === "string" ? parseInt(r.counter, 10) : Number(r.counter ?? 0),
    transports: Array.isArray(r.transports) ? r.transports : [],
    deviceType: r.device_type ?? null,
    backedUp: !!r.backed_up,
    label: r.label ?? null,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at ?? null,
  };
}

export async function listPasskeys(): Promise<PasskeyRow[]> {
  try {
    const res = await pool.query(
      `SELECT credential_id, public_key, counter, transports, device_type,
              backed_up, label, created_at, last_used_at
       FROM admin_passkeys
       ORDER BY created_at DESC`,
    );
    return res.rows.map(mapRow);
  } catch {
    // Table may not exist yet (pre-migration) — treat as "no passkeys".
    return [];
  }
}

export async function countPasskeys(): Promise<number> {
  try {
    const res = await pool.query(`SELECT COUNT(*)::int AS c FROM admin_passkeys`);
    return res.rows[0]?.c ?? 0;
  } catch {
    return 0;
  }
}

export async function getPasskey(credentialId: string): Promise<PasskeyRow | null> {
  const res = await pool.query(
    `SELECT credential_id, public_key, counter, transports, device_type,
            backed_up, label, created_at, last_used_at
     FROM admin_passkeys WHERE credential_id = $1`,
    [credentialId],
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

async function insertPasskey(row: {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: AuthenticatorTransportFuture[];
  deviceType: string | null;
  backedUp: boolean;
  label: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO admin_passkeys
       (credential_id, public_key, counter, transports, device_type, backed_up, label)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      row.credentialId,
      row.publicKey,
      row.counter,
      row.transports,
      row.deviceType,
      row.backedUp,
      row.label,
    ],
  );
}

async function touchPasskey(credentialId: string, newCounter: number): Promise<void> {
  await pool.query(
    `UPDATE admin_passkeys
     SET counter = $2, last_used_at = NOW()
     WHERE credential_id = $1`,
    [credentialId, newCounter],
  );
}

export async function deletePasskey(credentialId: string): Promise<boolean> {
  const res = await pool.query(`DELETE FROM admin_passkeys WHERE credential_id = $1`, [
    credentialId,
  ]);
  return (res.rowCount || 0) > 0;
}

// ── Base64url <-> Uint8Array helpers (for the stored COSE public key) ────────

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlToBytes(b64: string) {
  // Allocate a fresh ArrayBuffer-backed Uint8Array so the inferred type is
  // Uint8Array<ArrayBuffer> (what @simplewebauthn's WebAuthnCredential expects
  // under TypeScript 5.7's generic Uint8Array), not Uint8Array<ArrayBufferLike>.
  const buf = Buffer.from(b64, "base64url");
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

// ── Registration ceremony ────────────────────────────────────────────────────

export async function buildRegistrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpName, rpID } = getPasskeyConfig();
  const existing = await listPasskeys();

  return await generateRegistrationOptions({
    rpName,
    rpID,
    userName: ADMIN_USER_NAME,
    userDisplayName: ADMIN_USER_DISPLAY,
    userID: new TextEncoder().encode(ADMIN_USER_NAME),
    attestationType: "none",
    // Prevent re-enrolling a device that's already registered.
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
}

export async function confirmRegistration(opts: {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  label?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { rpID, origin } = getPasskeyConfig();
  try {
    const verification = await verifyRegistrationResponse({
      response: opts.response,
      expectedChallenge: opts.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return { ok: false, error: "Vérification de l'enrôlement échouée." };
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    await insertPasskey({
      credentialId: credential.id,
      publicKey: bytesToBase64Url(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType ?? null,
      backedUp: !!credentialBackedUp,
      label: opts.label?.trim() ? opts.label.trim().slice(0, 120) : null,
    });

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Erreur d'enrôlement." };
  }
}

// ── Authentication ceremony ───────────────────────────────────────────────────

export async function buildAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = getPasskeyConfig();
  const existing = await listPasskeys();

  return await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    // If we know the registered credentials, hint them so compatible browsers
    // surface the right authenticator. Empty list => the client lets the user
    // pick a discoverable credential.
    allowCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports,
    })),
  });
}

export async function confirmAuthentication(opts: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { rpID, origin } = getPasskeyConfig();
  try {
    const credentialId = opts.response?.id;
    if (!credentialId) {
      return { ok: false, error: "Réponse d'authentification invalide." };
    }

    const row = await getPasskey(credentialId);
    if (!row) {
      return { ok: false, error: "Passkey inconnue." };
    }

    const credential: WebAuthnCredential = {
      id: row.credentialId,
      publicKey: base64UrlToBytes(row.publicKey),
      counter: row.counter,
      transports: row.transports,
    };

    const verification = await verifyAuthenticationResponse({
      response: opts.response,
      expectedChallenge: opts.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: false,
    });

    if (!verification.verified) {
      return { ok: false, error: "Authentification refusée." };
    }

    await touchPasskey(row.credentialId, verification.authenticationInfo.newCounter);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Erreur d'authentification." };
  }
}
