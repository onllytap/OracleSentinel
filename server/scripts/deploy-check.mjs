#!/usr/bin/env node
// ============================================================================
// deploy-check.mjs — Vérification "prêt à déployer" (feu vert / rouge)
// ============================================================================
// Sonde un serveur DÉJÀ LANCÉ et dit, en clair, si on peut déployer un chatbot
// via /factory. LECTURE SEULE : ne lance JAMAIS de build, n'écrit rien, ne
// modifie aucune config. Il appelle uniquement des endpoints de diagnostic.
//
// Étapes :
//   1. GET  /api/health                  → serveur + base de données
//   2. POST /api/admin/session           → login admin (clé [+ TOTP si 2FA])
//   3. GET  /api/factory/readiness       → portail de readiness (blockers/warnings)
//   4. POST /api/factory/test/database   → connexion DB en direct
//   5. POST /api/factory/test/llm        → LLM (Groq) en direct  ← le test clé
//   6. POST /api/factory/test/crm        → CRM en direct (non bloquant)
//
// Usage :
//   node scripts/deploy-check.mjs [baseUrl]
//     baseUrl     : défaut http://localhost:3001 (ou env DEPLOY_CHECK_URL)
//     clé admin   : env ADMIN_API_KEY, sinon lue dans .env (racine) ou server/.env
//     TOTP (2FA)  : env ADMIN_TOTP (si la 2FA est activée)
//
// Zéro dépendance (fetch natif Node 18+). Ne logge jamais la clé ni un secret.
// Code de sortie : 0 = prêt, 1 = pas prêt / erreur.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SERVER_DIR, "..");

const BASE_URL = (
  process.argv[2] ||
  process.env.DEPLOY_CHECK_URL ||
  "http://localhost:3001"
).replace(/\/+$/, "");
const TIMEOUT_MS = 20000;

// ── Couleurs ANSI (dégradent proprement si non supportées) ───────────────────
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};
const OK = `${C.green}OK${C.reset}`;
const FAIL = `${C.red}ÉCHEC${C.reset}`;
const WARN = `${C.yellow}ATTENTION${C.reset}`;

// ── Lecture de la clé admin (jamais affichée) ────────────────────────────────
function parseEnv(file) {
  const out = {};
  try {
    const txt = fs.readFileSync(file, "utf-8");
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
  } catch {
    /* fichier absent → ignoré */
  }
  return out;
}

function resolveAdminKey() {
  if (process.env.ADMIN_API_KEY && process.env.ADMIN_API_KEY.trim()) {
    return process.env.ADMIN_API_KEY.trim();
  }
  for (const f of [
    path.join(REPO_ROOT, ".env"),
    path.join(SERVER_DIR, ".env"),
  ]) {
    const k = parseEnv(f)["ADMIN_API_KEY"];
    if (k && k.trim()) return k.trim();
  }
  return "";
}

const ADMIN_KEY = resolveAdminKey();
const TOTP = (process.env.ADMIN_TOTP || "").trim();

// ── HTTP avec cookie jar + CSRF ──────────────────────────────────────────────
let cookie = "";
let csrf = "";

async function req(method, p, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const headers = { Accept: "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  if (["POST", "PUT", "DELETE"].includes(method) && csrf) {
    headers["X-CSRF-Token"] = csrf;
  }
  if (body != null) headers["Content-Type"] = "application/json";
  try {
    const res = await fetch(`${BASE_URL}${p}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const a = setCookie.match(/admin_session=([^;]+)/);
      const c = setCookie.match(/csrf_token=([^;]+)/);
      if (a) {
        cookie = `admin_session=${a[1]}`;
        if (c) {
          cookie += `; csrf_token=${c[1]}`;
          csrf = c[1];
        }
      }
    }
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw: raw.slice(0, 300) };
    }
    return { status: res.status, ok: res.ok, data };
  } finally {
    clearTimeout(t);
  }
}

function line(label, statusText, detail) {
  const dot = ".".repeat(Math.max(2, 28 - label.length));
  console.log(
    `  ${label} ${C.dim}${dot}${C.reset} ${statusText}` +
      (detail ? `  ${C.dim}${detail}${C.reset}` : ""),
  );
}

// ── Programme principal ──────────────────────────────────────────────────────
async function main() {
  console.log(
    `\n${C.bold}=== OracleSentinel — Vérification "prêt à déployer" ===${C.reset}`,
  );
  console.log(`  Cible : ${C.cyan}${BASE_URL}${C.reset}\n`);

  let ready = true;
  let dbOk = false;
  let llmOk = false;

  // 1) Santé serveur + DB
  try {
    const r = await req("GET", "/api/health");
    dbOk = r.data?.database === "ok";
    if (r.status === 200 && dbOk) {
      line("1. Santé serveur + DB", OK, `db: ${r.data?.database}`);
    } else {
      ready = false;
      line(
        "1. Santé serveur + DB",
        FAIL,
        `http ${r.status}, db: ${r.data?.database || "?"}`,
      );
    }
  } catch (e) {
    console.log(
      `  ${C.red}Serveur injoignable sur ${BASE_URL}${C.reset}\n` +
        `  → Démarre-le d'abord :  ${C.cyan}cd server && npm run dev${C.reset}\n` +
        `  → ou cible la prod :    ${C.cyan}node scripts/deploy-check.mjs https://api.oraclesentinel.com${C.reset}`,
    );
    process.exit(1);
  }

  // 2) Login admin
  if (!ADMIN_KEY) {
    ready = false;
    line("2. Login admin", FAIL, "ADMIN_API_KEY introuvable (.env / env)");
  } else {
    const body = { key: ADMIN_KEY };
    if (TOTP) body.totp = TOTP;
    const r = await req("POST", "/api/admin/session", body);
    if (r.ok && r.data?.success) {
      line("2. Login admin", OK, csrf ? "session + CSRF" : "session");
    } else if (r.data?.error === "totp_required") {
      ready = false;
      line(
        "2. Login admin",
        FAIL,
        "2FA activée → relance avec  ADMIN_TOTP=123456",
      );
    } else {
      ready = false;
      line("2. Login admin", FAIL, `http ${r.status} ${r.data?.error || ""}`);
    }
  }

  // Les étapes suivantes nécessitent une session.
  const authed = !!cookie;

  // 3) Readiness gate
  if (authed) {
    const r = await req("GET", "/api/factory/readiness");
    const rep = r.data?.readiness;
    if (r.ok && rep) {
      const lvl = rep.level;
      const nb = (rep.blockers || []).length;
      const nw = (rep.warnings || []).length;
      if (lvl === "READY" || lvl === "WARNING") {
        line(
          "3. Readiness /factory",
          nw ? WARN : OK,
          `${lvl} — ${nb} blocker(s), ${nw} warning(s)`,
        );
      } else {
        ready = false;
        line("3. Readiness /factory", FAIL, `${lvl} — ${nb} blocker(s)`);
      }
      for (const b of rep.blockers || []) console.log(`       ${C.red}• ${b}${C.reset}`);
      for (const w of rep.warnings || []) console.log(`       ${C.yellow}• ${w}${C.reset}`);
    } else {
      ready = false;
      line("3. Readiness /factory", FAIL, `http ${r.status}`);
    }
  } else {
    line("3. Readiness /factory", "—", "ignoré (pas de session)");
  }

  // 4) Test DB en direct
  if (authed) {
    const r = await req("POST", "/api/factory/test/database", {});
    if (r.ok && r.data?.success) {
      line("4. Test DB (live)", OK);
    } else {
      ready = false;
      line("4. Test DB (live)", FAIL, r.data?.error || `http ${r.status}`);
    }
  }

  // 5) Test LLM / Groq en direct — LE test clé (clé présente ≠ valide)
  if (authed) {
    const r = await req("POST", "/api/factory/test/llm", {});
    llmOk = !!(r.ok && r.data?.success);
    if (llmOk) {
      line(
        "5. Test LLM / Groq (live)",
        OK,
        `${r.data?.provider || ""} ${r.data?.model || ""}`.trim(),
      );
    } else {
      ready = false;
      line(
        "5. Test LLM / Groq (live)",
        FAIL,
        r.data?.error || "clé Groq invalide ou injoignable",
      );
    }
  }

  // 6) Test CRM en direct — non bloquant (un bot peut tourner sans push CRM)
  if (authed) {
    const r = await req("POST", "/api/factory/test/crm", {});
    if (r.ok && r.data?.success) {
      line("6. Test CRM (live)", OK);
    } else {
      line(
        "6. Test CRM (live)",
        WARN,
        (r.data?.error || "non configuré") + " — n'empêche pas le déploiement",
      );
    }
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  console.log("");
  if (ready) {
    console.log(
      `  ${C.bold}${C.green}✅ VERDICT : PRÊT À DÉPLOYER via /factory${C.reset}`,
    );
    console.log(
      `  ${C.dim}DB + LLM(Groq) + readiness au vert. Tu peux configurer/builder un bot.${C.reset}\n`,
    );
    process.exit(0);
  } else {
    console.log(
      `  ${C.bold}${C.red}❌ VERDICT : PAS ENCORE PRÊT${C.reset}`,
    );
    console.log(
      `  ${C.dim}Corrige les lignes en ÉCHEC ci-dessus puis relance ce script.${C.reset}\n`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n${C.red}Erreur inattendue : ${e?.message || e}${C.reset}\n`);
  process.exit(1);
});
