# ============================================================================
# AI Agent Factory — Production Dockerfile
# ============================================================================
# Multi-stage build for minimal, secure production image.
#
# Usage:
#   docker build -t ai-agent-factory .
#   docker run --env-file .env -p 3001:3001 ai-agent-factory
#
# Or with docker-compose:
#   docker compose up -d
# ============================================================================

# ── Stage 1: Install dependencies ──────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install only production + build dependencies
COPY package.json package-lock.json* ./

# Install all deps (including devDependencies for TypeScript compilation)
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts

# ── Stage 2: Build TypeScript ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript.
# NOTE: do NOT mask tsc errors with "|| true" — a failed compile must fail the build,
# otherwise partially-compiled / type-unsafe code can ship to production.
RUN npx tsc --build tsconfig.json

# Verify dist was created
RUN test -f dist/index.js || (echo "ERROR: TypeScript compilation failed — dist/index.js not found" && exit 1)

# ── Stage 3: Production image ──────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# Copy compiled JS from builder
COPY --from=builder /app/dist ./dist

# Copy migration files (needed at runtime for ensure-db)
COPY src/db/migrations/ ./dist/db/migrations/

# Create directories for runtime data
RUN mkdir -p /app/data /app/logs && \
    chown -R appuser:appgroup /app

# Health check — ensures the server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Switch to non-root user
USER appuser

# Expose the server port
EXPOSE 3001

# Environment defaults (override via .env or docker-compose)
ENV NODE_ENV=production \
    PORT=3001

# Start the server
CMD ["node", "dist/index.js"]
