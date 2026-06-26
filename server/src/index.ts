import "./env";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { getReleaseName, Sentry } from "./monitoring/sentry";
import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = process.env.PORT || 3001;

app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

import chatRoutes from "./routes/chat.routes";
import knowledgeRoutes from "./routes/knowledge.routes";
import catalogRoutes from "./routes/catalog.routes";
import adminRoutes, { adminPageHandler } from "./routes/admin.routes";
import crmWebhookRoutes from "./routes/crm-webhook.routes";
import factoryRoutes from "./routes/factory.routes";
import factoryPageHandler from "./routes/factory-ui.routes";
import commandCenterRoutes, { privPageHandler } from "./routes/command-center.routes";
// v2.1 — Command Center plateforme multi-agences (montés sous /api/priv, gated).
// Stubs en T0 (501), remplis par leurs vagues respectives.
import tenantRoutes from "./routes/tenant.routes";
import tenantCrmRoutes from "./routes/tenant-crm.routes";
import billingRoutes from "./routes/billing.routes";
import rgpdRoutes from "./routes/rgpd.routes";
import metricsRoutes from "./routes/metrics.routes";
import redeployRoutes from "./routes/redeploy.routes";
import estimationRoutes from "./routes/estimation.routes";
import mandatesRoutes from "./routes/mandates.routes";
import { initDb } from "./db";
import { assertDatabaseConnection } from "./db/pool";
import { ensureDbSchema } from "./db/ensure-db";
import { createPostgresStore } from "./middleware/rate-limit-store";
import { widgetAuthHandler } from "./middleware/widget-auth";
import { logger } from "./utils/logger";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// IPs that bypass rate limiting entirely (comma-separated in RATE_LIMIT_WHITELIST).
const RATE_LIMIT_WHITELIST = new Set(
  (process.env.RATE_LIMIT_WHITELIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function isWhitelistedIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, ""); // IPv4-mapped IPv6 → IPv4
  return RATE_LIMIT_WHITELIST.has(ip) || RATE_LIMIT_WHITELIST.has(normalized);
}

// Optional IP allowlist for the admin / super-admin surfaces (defense in depth).
// EMPTY BY DEFAULT -> NO filtering (zero behaviour change). When ADMIN_IP_ALLOWLIST
// is set (CSV of IPs), requests to /api/admin and /api/priv from any other IP get
// a 403. Pairs with `trust proxy` so req.ip reflects the real client behind the
// reverse proxy in production.
const ADMIN_IP_ALLOWLIST = new Set(
  (process.env.ADMIN_IP_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function adminIpAllowlist() {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (ADMIN_IP_ALLOWLIST.size === 0) return next(); // disabled by default
    const ip = req.ip || "";
    const normalized = ip.replace(/^::ffff:/, "");
    if (ADMIN_IP_ALLOWLIST.has(ip) || ADMIN_IP_ALLOWLIST.has(normalized)) {
      return next();
    }
    logger.warn(
      { ip: normalized, path: req.originalUrl || req.url },
      "Admin IP allowlist: blocked request",
    );
    return res.status(403).json({ error: "Forbidden" });
  };
}

const parseAllowedOrigins = (): string[] => {
  const raw = process.env.WIDGET_ALLOWED_ORIGINS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const corsOptions = {
  origin:
    process.env.NODE_ENV === "production"
      ? parseAllowedOrigins().length > 0
        ? parseAllowedOrigins()
        : [process.env.FRONTEND_URL || "https://oraclesentinel.com"]
      : Array.from(
          new Set([
            ...parseAllowedOrigins(),
            "http://localhost:5173",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
          ]),
        ),
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-CSRF-Token",
  ],
  credentials: true,
  maxAge: 86400,
};

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  next();
});

app.use(cors(corsOptions));

// ── Better Auth (multi-user / 2FA upgrade path for /priv) ───────────────────
// Mounted BEFORE express.json() because Better Auth consumes the raw body.
// Guarded so a missing secret or unmigrated DB never breaks server startup.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { toNodeHandler } = require("better-auth/node");
  const { auth, isBetterAuthConfigured } = require("./auth/auth");
  if (isBetterAuthConfigured) {
    app.all("/api/auth/*", toNodeHandler(auth));
    logger.info("Better Auth mounted at /api/auth/*");
  } else {
    logger.warn("Better Auth not mounted: BETTER_AUTH_SECRET or DATABASE_URL missing");
  }
} catch (err) {
  logger.warn({ err }, "Better Auth could not be mounted; continuing without it");
}

// ── Stripe webhook (facturation R18) — PUBLIC, corps BRUT, AVANT express.json ──
// La signature (Stripe-Signature: t=…,v1=…) est vérifiée par billing.service
// (HMAC-SHA256 de `${t}.${rawBody}` avec STRIPE_WEBHOOK_SECRET). Import gardé :
// tant que billing.service (T2) n'existe pas, on répond 503 sans casser le boot.
// BILLING_ENABLED=false → la facturation est inerte ; ce endpoint reste inoffensif.
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const billing = require("./services/billing.service");
      if (billing && typeof billing.stripeWebhookHandler === "function") {
        return billing.stripeWebhookHandler(req, res);
      }
    } catch {
      /* billing.service pas encore livré (T2) — dégrade proprement */
    }
    return res.status(503).json({ error: "billing_not_configured" });
  },
);

app.use(express.json({ limit: "1mb" }));

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existing = req.headers["x-request-id"];
      const requestId = Array.isArray(existing) ? existing[0] : existing || randomUUID();
      res.setHeader("X-Request-Id", requestId);
      return requestId;
    },
    autoLogging: {
      ignore: (req) => req.url === "/health" || req.url === "/api/health",
    },
  }),
);

const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: 600,
  message: { error: "Trop de requêtes, veuillez réessayer plus tard." },
  store: createPostgresStore(RATE_LIMIT_WINDOW_MS),
  standardHeaders: true,
  legacyHeaders: false,
  // Bypass for whitelisted IPs, and for read-only session-gated monitoring
  // endpoints the Command Center polls (can't be brute-forced).
  skip: (req) =>
    isWhitelistedIp(req.ip) ||
    (req.method === "GET" &&
      /^\/api\/(priv\/|admin\/(status|db\/))/.test(req.originalUrl)),
});
app.use("/api/", limiter);

// API Routes
app.get("/api/widget-auth", widgetAuthHandler());
app.use("/api", chatRoutes);
app.use("/api/knowledge", knowledgeRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/crm/webhook", crmWebhookRoutes);

// ── Module "machine à mandats" — endpoint d'estimation (utilisé par le widget) ─
// L'estimation se fait DANS le chatbot (bouton "Estimation gratuite" -> formulaire
// intégré). /api/estimate est public, couvert par le rate-limiter /api/ ci-dessus.
app.use("/api", estimationRoutes);

// Hidden admin page + admin API (session cookie)
// adminIpAllowlist() is a no-op unless ADMIN_IP_ALLOWLIST is configured.
app.get("/admin", adminIpAllowlist(), adminPageHandler);
app.use("/api/admin", adminIpAllowlist(), adminRoutes);

// Factory Command Center (agent configuration & build pipeline)
app.get("/factory", factoryPageHandler);
app.use("/api/factory", factoryRoutes);

// ── /priv — OracleSentinel Super-Admin Command Center ───────────────────────
// Page is gated client-side by login; the infra API is hard-gated server-side
// by requireAdminSession() inside command-center.routes.
app.get("/priv", adminIpAllowlist(), privPageHandler);
app.use("/api/priv", adminIpAllowlist(), commandCenterRoutes);
// v2.1 — routers additifs montés sur /api/priv (gated par requireAdminSession par
// route à l'intérieur ; chemins distincts → ne masquent pas command-center.routes).
app.use("/api/priv", adminIpAllowlist(), tenantRoutes);
app.use("/api/priv", adminIpAllowlist(), tenantCrmRoutes);
app.use("/api/priv", adminIpAllowlist(), billingRoutes);
app.use("/api/priv", adminIpAllowlist(), rgpdRoutes);
app.use("/api/priv", adminIpAllowlist(), metricsRoutes);
app.use("/api/priv", adminIpAllowlist(), redeployRoutes);
app.use("/api/priv", adminIpAllowlist(), mandatesRoutes);

// ── /qg — Command Center (React) served in production ───────────────────────
// The full enterprise dashboard (src/dashboard/CommandCenter.tsx) is built by
// `npm run build` (repo root) into build/dashboard.html + build/assets/*. We
// serve those static assets and the page here so the QG is reachable in
// production. In development use Vite (`npm run dev`, port 3000). The
// lightweight infra+fleet page at /priv is kept untouched as a fallback.
const resolveCommandCenterBuildDir = (): string | null => {
  const candidates = [
    path.join(__dirname, "../../build"), // local: server/dist|src → repo/build
    path.join(__dirname, "../build"), // full-stack docker: /app/dist → /app/build
    path.join(process.cwd(), "build"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "dashboard.html"))) return dir;
    } catch {
      /* ignore and try next candidate */
    }
  }
  return null;
};
const COMMAND_CENTER_BUILD_DIR = resolveCommandCenterBuildDir();

if (COMMAND_CENTER_BUILD_DIR) {
  // Serve hashed JS/CSS/asset files. index:false so "/" is never auto-served;
  // static only responds for files that exist, so it never shadows API routes.
  app.use(
    express.static(COMMAND_CENTER_BUILD_DIR, { index: false, maxAge: "1h" }),
  );
  logger.info(
    { dir: COMMAND_CENTER_BUILD_DIR },
    "Command Center (React) build served at /qg",
  );
} else {
  logger.warn(
    "Command Center build not found; /qg shows a build hint (run `npm run build`)",
  );
}

app.get("/qg", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  if (!COMMAND_CENTER_BUILD_DIR) {
    res.status(503);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      `<!doctype html><meta charset="utf-8"><title>QG — build requis</title>` +
        `<body style="font-family:system-ui;background:#050a14;color:#e5e7eb;padding:40px;line-height:1.6">` +
        `<h1 style="color:#5b8cff">Command Center non compilé</h1>` +
        `<p>Le QG React n'est pas encore build. Lancez à la racine :</p>` +
        `<pre style="background:#0d1426;border:1px solid #1c2742;padding:14px;border-radius:10px">npm run build</pre>` +
        `<p>En développement, utilisez Vite (<code>npm run dev</code>, port 3000) ou la page <a href="/priv" style="color:#5b8cff">/priv</a>.</p>` +
        `</body>`,
    );
    return;
  }
  res.sendFile(path.join(COMMAND_CENTER_BUILD_DIR, "dashboard.html"));
});

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeCssColor = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ? trimmed : fallback;
};

const safeWidgetId = (value: unknown): string =>
  typeof value === "string" && /^[a-zA-Z0-9_.-]{1,128}$/.test(value)
    ? value
    : "default";

const requestBaseUrl = (req: express.Request): string => {
  const protocol = req.protocol === "https" ? "https" : "http";
  const rawHost = req.get("host") || "";
  // Only allow valid host characters (hostname, optional port, IPv6 brackets).
  // This strips any attempt to inject markup (e.g. "</script>") via the Host
  // header before the value is embedded into the /embed page. Prevents XSS.
  const host = /^[A-Za-z0-9.\-:[\]]{1,255}$/.test(rawHost) ? rawHost : "";
  return `${protocol}://${host}`;
};

// Hosted widget embed page — serves the chatbot inside an iframe-friendly page
// This is the target URL for FACTORY_EMBED_MODE=hosted
app.get("/embed", (req, res) => {
  const widgetId = safeWidgetId(req.query.widget_id);
  const widgetIdHtml = escapeHtml(widgetId);
  const agentName = escapeHtml(
    process.env.FACTORY_AGENT_NAME || "AI Assistant",
  );
  const primary = safeCssColor(process.env.FACTORY_THEME_PRIMARY || "", "#6366f1");
  const bg = safeCssColor(process.env.FACTORY_THEME_BG || "", "#0b1220");
  const surface = safeCssColor(
    process.env.FACTORY_THEME_SURFACE || "",
    "#0f172a",
  );
  const text = safeCssColor(process.env.FACTORY_THEME_TEXT || "", "#e5e7eb");
  const apiBaseJson = JSON.stringify(requestBaseUrl(req));
  const widgetIdJson = JSON.stringify(widgetId);
  // Allow embedding in iframes
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; frame-ancestors *; base-uri 'none'; form-action 'none'",
  );
  res.send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${agentName} — Chat</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:${bg};color:${text};font-family:system-ui,-apple-system,sans-serif;height:100vh;display:flex;flex-direction:column}
.chat-header{background:${surface};border-bottom:1px solid ${primary}33;padding:14px 20px;display:flex;align-items:center;gap:10px}
.chat-header .dot{width:10px;height:10px;border-radius:50%;background:${primary};box-shadow:0 0 8px ${primary}}
.chat-header h1{font-size:15px;font-weight:600}
.chat-container{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:85%;padding:12px 16px;border-radius:16px;font-size:14px;line-height:1.5}
.msg.bot{background:${surface};border:1px solid ${primary}22;align-self:flex-start;border-bottom-left-radius:4px}
.msg.user{background:${primary};color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
.input-bar{background:${surface};border-top:1px solid ${primary}33;padding:12px 16px;display:flex;gap:10px}
.input-bar input{flex:1;background:${bg};border:1px solid ${primary}33;color:${text};border-radius:24px;padding:10px 16px;font-size:14px;outline:none}
.input-bar input:focus{border-color:${primary}}
.input-bar button{background:${primary};color:#fff;border:none;border-radius:24px;padding:10px 20px;font-size:14px;cursor:pointer;font-weight:600}
.input-bar button:hover{opacity:0.9}
.powered{text-align:center;padding:6px;font-size:10px;color:${text}66}
</style>
</head>
<body>
<div class="chat-header"><div class="dot"></div><h1>${agentName}</h1></div>
<div class="chat-container" id="messages">
<div class="msg bot">Bonjour ! Comment puis-je vous aider aujourd'hui ?</div>
</div>
<div class="input-bar">
<input id="input" type="text" placeholder="Tapez votre message..." autocomplete="off"/>
<button id="send">Envoyer</button>
</div>
<div class="powered">Powered by OracleSentinel &bull; widget_id=${widgetIdHtml}</div>
<script>
(function(){
var API=${apiBaseJson};
var widgetId=${widgetIdJson};
var sessionId='smoke_'+Date.now();
var token=null;
var msgs=document.getElementById('messages');
var input=document.getElementById('input');
function addMsg(text,cls){var d=document.createElement('div');d.className='msg '+cls;d.textContent=text;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;}
async function auth(){try{var r=await fetch(API+'/api/widget-auth?widget_id='+widgetId);var d=await r.json();token=d.token||null;}catch(e){console.warn('Auth:',e);}}
async function send(){var t=input.value.trim();if(!t)return;addMsg(t,'user');input.value='';
try{if(!token)await auth();var r=await fetch(API+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({message:t,sessionId:sessionId})});var d=await r.json();addMsg(d.response||d.message||'...','bot');}catch(e){addMsg('Erreur: '+e.message,'bot');}}
document.getElementById('send').onclick=send;
input.addEventListener('keydown',function(e){if(e.key==='Enter')send();});
auth();
})();
</script>
</body>
</html>`);
});

app.get("/health", async (_req, res) => {
  const database = await assertDatabaseConnection();
  res.status(database ? 200 : 503).json({
    status: database ? "ok" : "degraded",
    database: database ? "ok" : "unavailable",
    release: getReleaseName(),
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

// Alias for /health under /api prefix (used by smoke test & monitoring)
app.get("/api/health", async (_req, res) => {
  const database = await assertDatabaseConnection();
  res.status(database ? 200 : 503).json({
    status: database ? "ok" : "degraded",
    database: database ? "ok" : "unavailable",
    release: getReleaseName(),
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

app.use(
  (
    err: Error & { status?: number; statusCode?: number; code?: string },
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const statusCode = err.statusCode || err.status || 500;
    const requestId =
      res.getHeader("X-Request-Id") ||
      req.headers["x-request-id"] ||
      randomUUID();
    const normalizedRequestId = Array.isArray(requestId)
      ? requestId[0]
      : String(requestId);

    logger.error(
      {
        err,
        requestId: normalizedRequestId,
        req: {
          method: req.method,
          url: req.originalUrl || req.url,
          ip: req.ip,
        },
        statusCode,
      },
      "Unhandled route error",
    );

    Sentry.captureException(err, {
      extra: { statusCode },
      tags: { requestId: normalizedRequestId, route: req.path },
    });

    res.status(statusCode).json({
      success: false,
      error:
        process.env.NODE_ENV === "production"
          ? "Une erreur interne est survenue"
          : err.message,
      code: err.code || "INTERNAL_ERROR",
      requestId: normalizedRequestId,
    });
  },
);

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  Sentry.captureException(reason);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  Sentry.captureException(err);
  process.exit(1);
});

// Start Server
const startServer = async () => {
  try {
    try {
      await ensureDbSchema();
      await initDb();
    } catch (error) {
      logger.error({ err: error }, "Startup DB checks failed; continuing in degraded mode");
    }

    app.listen(PORT, () => {
      logger.info({ port: PORT }, "Server started");
    });
  } catch (error) {
    logger.fatal({ err: error }, "Failed to start server");
    Sentry.captureException(error);
    process.exitCode = 1;
  }
};

startServer();
