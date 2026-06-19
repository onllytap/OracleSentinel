import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// ── PII redaction (RGPD) ────────────────────────────────────────────────────
// Utilities to mask personal data (email / phone) before it can leak into logs.
// They never drop information beyond the PII itself — the message shape and all
// non-PII content are preserved — and they are false-positive resistant: only
// values that clearly look like an email or a phone number are masked, so we
// never corrupt useful structured logs (IDs, durations, timestamps…).

// local-part@domain.tld  ->  keeps 1st char of local + 1st char of domain + TLD
const EMAIL_RE =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-])[A-Za-z0-9.-]*(\.[A-Za-z]{2,})/g;

// International (+33 6 12 …) and French national (06 12 34 56 78) numbers,
// tolerant to spaces / dots / dashes / parentheses. Short pure digit runs
// (IDs, durations, epoch timestamps) are intentionally NOT matched.
const PHONE_INTL_RE = /\+\d[\d\s().-]{6,}\d/g;
const PHONE_FR_RE = /\b0[1-9](?:[\s.-]?\d{2}){4}\b/g;

export function redactEmail(input: string): string {
  return input.replace(
    EMAIL_RE,
    (_m, local: string, domainHead: string, tld: string) =>
      `${local}***@${domainHead}***${tld}`,
  );
}

function maskPhoneRun(run: string): string {
  const digits = run.replace(/\D/g, "");
  if (digits.length < 8) return run; // too short to be a phone — leave as-is
  return `***${digits.slice(-2)}`;
}

export function redactPhone(input: string): string {
  return input.replace(PHONE_INTL_RE, maskPhoneRun).replace(PHONE_FR_RE, maskPhoneRun);
}

/** Mask email + phone inside a free-text string. */
export function redactPII(input: unknown): string {
  if (typeof input !== "string") return String(input);
  return redactPhone(redactEmail(input));
}

/**
 * Recursively mask PII inside the strings of an object/array. Use this
 * explicitly before logging a structured payload that may embed personal data
 * at arbitrary depth (pino's path-based redaction only covers known fields).
 */
export function redactPIIDeep<T>(value: T): T {
  if (typeof value === "string") return redactPII(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactPIIDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactPIIDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
  serializers: pino.stdSerializers,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.authorization",
      "*.cookie",
      "*.password",
      "*.apiKey",
      "*.api_key",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.secret",
      // PII (RGPD): mask personal identifiers wherever they appear as fields.
      "email",
      "phone",
      "telephone",
      "tel",
      "*.email",
      "*.phone",
      "*.telephone",
      "*.tel",
      "req.body.email",
      "req.body.phone",
      "req.body.telephone",
    ],
    censor: "[REDACTED]",
  },
  hooks: {
    // Scrub inline PII (email / phone) from free-text message strings. Object
    // fields are handled precisely by `redact.paths` above; here we only touch
    // string arguments, leaving numbers/objects untouched, so structured logs
    // are never corrupted and no useful log is dropped.
    logMethod(inputArgs, method) {
      for (let i = 0; i < inputArgs.length; i++) {
        if (typeof inputArgs[i] === "string") {
          inputArgs[i] = redactPII(inputArgs[i] as string);
        }
      }
      return method.apply(this, inputArgs as Parameters<typeof method>);
    },
  },
});

export type Logger = pino.Logger;

export const createChildLogger = (module: string): Logger => logger.child({ module });
