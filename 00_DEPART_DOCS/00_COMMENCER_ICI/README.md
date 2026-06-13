# AI Agent Factory — Lead Generation Chatbot

Production-ready, multi-tenant chatbot with LLM-powered lead qualification and CRM integration.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS + Radix UI |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL 16 |
| LLM | Groq (Llama 3.3 70B) + OpenRouter fallback |
| CRM | Airtable (webhooks) + Twenty API (factory pattern) |
| Deploy | Docker Compose |

## Quick Start — Development

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ (local or Docker)
- Groq API key ([console.groq.com](https://console.groq.com))

### 1. Install dependencies

```bash
# Frontend
npm install

# Backend
cd server && npm install
```

### 2. Configure environment

```bash
# Copy and edit backend env
cp server/.env.example server/.env
# Fill in: DATABASE_URL, GROQ_API_KEY, BOT_PROFILE, CRM_PROVIDER
```

### 3. Initialize database

```bash
cd server && npm run ensure-db
```

### 4. Start dev servers

```bash
# Terminal 1 — Backend (port 3001)
cd server && npm run dev

# Terminal 2 — Frontend (port 3000)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the chat widget.
Admin panel at [http://localhost:3001/admin](http://localhost:3001/admin).
Factory dashboard at [http://localhost:3001/factory](http://localhost:3001/factory).

---

## Quick Start — Production (Docker)

### 1. Configure

```bash
cp server/.env.example server/.env
# Edit server/.env with production values
```

### 2. Build & start

```bash
cd server
docker compose up -d --build
```

This starts:
- **PostgreSQL 16** on port 5432 (configurable via `DB_PORT`)
- **AI Agent Factory** on port 3001 (configurable via `FACTORY_PORT`)

### 3. Verify

```bash
# Health check
curl http://localhost:3001/health

# Smoke tests (from server dir, with running server)
npm run factory:smoke
```

### Stop

```bash
docker compose down       # Stop services
docker compose down -v    # Stop + delete DB volume
```

---

## Build Commands

| Command | Location | Description |
|---|---|---|
| `npm run build` | Root (`D:\Chatbot`) | Build frontend → `build/` |
| `npm run dev` | Root | Start Vite dev server (port 3000) |
| `npm run dev` | `server/` | Start backend dev server (port 3001) |
| `npm run build` | `server/` | Compile TypeScript → `dist/` |
| `npm run start` | `server/` | Run production server from `dist/` |
| `npm run init-db` | `server/` | Create DB tables (destructive) |
| `npm run ensure-db` | `server/` | Idempotent schema migration |
| `npm run factory:smoke` | `server/` | Basic smoke test |
| `npm run factory:smoke:full` | `server/` | Full smoke test (phase 2) |
| `npm run test:ui-build` | `server/` | Test frontend build pipeline |
| `docker compose up -d` | `server/` | Start Docker stack |
| `docker compose up -d --build` | `server/` | Rebuild + start |

---

## API Routes

### Chat (Widget Auth — JWT)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/widget-auth` | Get JWT token for widget |
| `POST` | `/api/chat` | Send message, get AI response |
| `GET` | `/api/conversations` | List conversations |
| `GET` | `/api/conversations/:id/messages` | Get conversation messages |
| `POST` | `/api/leads` | Submit lead form |

### Knowledge (Admin API Key)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/knowledge/refresh` | Force refresh knowledge cache |
| `GET` | `/api/knowledge/status` | Get cache status |

### Factory (Admin Session — Cookie + CSRF)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/factory/config` | Get current config |
| `PUT` | `/api/factory/config` | Update config |
| `POST` | `/api/factory/build` | Execute full build pipeline |
| `GET` | `/api/factory/readiness` | Run production readiness checks |
| `GET` | `/api/factory/observability` | System metrics snapshot |
| `POST` | `/api/factory/test/llm` | Test LLM connection |
| `POST` | `/api/factory/test/crm` | Test CRM connection |
| `POST` | `/api/factory/test/database` | Test DB connection |

---

## Environment Variables

### Required

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@localhost:5432/chatbot` |
| `GROQ_API_KEY` | Primary Groq API key | `gsk_...` |
| `BOT_PROFILE` | Profile template from `profiles/` | `garage_motrio` |
| `JWT_SECRET` | Secret for widget JWT tokens | (64+ hex chars) |
| `ADMIN_API_KEY` | Admin API key | (32+ hex chars) |

### LLM Configuration

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `groq` | `groq` or `openrouter` |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model name |
| `GROQ_API_KEY_1..5` | — | Additional Groq keys for rotation |
| `OPENROUTER_API_KEY` | — | OpenRouter API key (fallback) |

### CRM Configuration

| Variable | Default | Description |
|---|---|---|
| `CRM_PROVIDER` | `none` | `airtable`, `twenty`, or `none` |
| `CRM_MIN_PUSH_SCORE` | `60` | Min qualification score to push lead |
| `AIRTABLE_WEBHOOK_URL` | — | Airtable webhook URL |
| `TWENTY_API_URL` | — | Twenty CRM API URL |
| `TWENTY_API_KEY` | — | Twenty CRM API key |

### Security

| Variable | Default | Description |
|---|---|---|
| `JWT_TTL_SECONDS` | `1200` | Widget token TTL (20 min) |
| `JWT_ALG` | `HS256` | JWT algorithm |
| `WIDGET_ALLOWED_ORIGINS` | — | Comma-separated CORS origins |

### Knowledge / RAG

| Variable | Default | Description |
|---|---|---|
| `RAG_ENABLED` | `true` | Enable RAG system |
| `KNOWLEDGE_URLS` | — | Comma-separated URLs to scrape |
| `KNOWLEDGE_CACHE_TTL` | `3600` | Cache TTL in seconds |

See `server/.env.example` for the complete list of 100+ configuration variables.

---

## Project Structure

```
D:\Chatbot/
├── src/                        # Frontend React + Vite
│   ├── App.tsx                 # Root component
│   ├── main.tsx                # Entry point
│   ├── components/             # UI components (ChatWidget, etc.)
│   ├── contexts/               # React contexts (Theme, Toast, etc.)
│   └── index.css               # TailwindCSS styles
├── server/                     # Backend Node.js + Express
│   ├── src/
│   │   ├── index.ts            # Express server entry
│   │   ├── routes/             # API route handlers
│   │   ├── services/           # Business logic (Chat, LLM, CRM, etc.)
│   │   ├── middleware/         # Auth, rate-limit, CSRF
│   │   ├── factory/            # Build pipeline, readiness, config
│   │   └── db/                 # Pool, schema, migrations
│   ├── scripts/                # Smoke tests, init-db, etc.
│   ├── Dockerfile              # Multi-stage production image
│   └── docker-compose.yml      # Full stack (app + postgres)
├── profiles/                   # Domain config templates (JSON)
├── tailwind.config.ts          # TailwindCSS config
├── postcss.config.js           # PostCSS config
├── vite.config.ts              # Vite bundler config
├── tsconfig.json               # TypeScript config (frontend)
└── package.json                # Frontend dependencies
```

---

## Profiles (Multi-Tenant)

Profiles in `profiles/` define per-domain branding, qualification rules, and CRM mappings:

- `garage_motrio.json` — Garage automobile
- `immobilier.json` — Agence immobilière
- `oraclesentinel.json` — Cabinet IA / Automatisation
- `restaurant.json` — Restaurant

Set via `BOT_PROFILE=garage_motrio` in `.env`. Profile overrides `BOT_DOMAIN`.

---

## Security

- **Widget**: JWT token, TTL 20 min, configurable origins
- **Admin**: Session cookie + CSRF double-submit
- **Rate Limit**: 100 req / 15 min / IP (PostgreSQL-backed store)
- **Headers**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
- **CORS**: Configurable allowed origins via `WIDGET_ALLOWED_ORIGINS`

---

## License

MIT
