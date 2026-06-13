// ============================================================================
// Factory UI — Full-Page Dashboard (Server-Rendered)
// ============================================================================
// This is the AI Agent Factory Command Center.
// A futuristic, dark-themed operations dashboard.
// Server-rendered HTML loaded from an external file for maintainability.
//
// The HTML is read from src/views/factory.html (or dist/views/factory.html
// in production) and cached in memory after first read.
// ============================================================================

import { Request, Response } from "express";
import fs from "fs";
import path from "path";

// ── HTML Cache ─────────────────────────────────────────────────────────────
// In production: read once, cache forever (restart to pick up changes).
// In development: re-read on every request for hot-reload convenience.

let cachedHtml: string | null = null;

function resolveHtmlPath(): string {
  // Try multiple locations in order of priority:
  // 1. dist/views/factory.html (production — copied during build)
  // 2. src/views/factory.html  (development — source file)
  const candidates = [
    path.join(__dirname, "../views/factory.html"), // dist/views/ (from dist/routes/)
    path.join(__dirname, "../../src/views/factory.html"), // src/views/ (from dist/routes/)
    path.join(__dirname, "../../views/factory.html"), // views/ relative fallback
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: return the most likely path and let the error handler deal with it
  return candidates[0];
}

function loadFactoryHtml(): string {
  const isDev = process.env.NODE_ENV !== "production";

  // In development, always re-read for hot-reload
  if (isDev) {
    const htmlPath = resolveHtmlPath();
    try {
      return fs.readFileSync(htmlPath, "utf-8");
    } catch (err: any) {
      console.error(`[Factory UI] Failed to read ${htmlPath}:`, err.message);
      return getErrorHtml(htmlPath, err.message);
    }
  }

  // In production, cache after first read
  if (cachedHtml !== null) {
    return cachedHtml;
  }

  const htmlPath = resolveHtmlPath();
  try {
    cachedHtml = fs.readFileSync(htmlPath, "utf-8");
    console.log(
      `[Factory UI] Loaded factory.html from ${htmlPath} (${cachedHtml.length} bytes, cached)`,
    );
    return cachedHtml;
  } catch (err: any) {
    console.error(`[Factory UI] Failed to read ${htmlPath}:`, err.message);
    return getErrorHtml(htmlPath, err.message);
  }
}

/**
 * Returns a minimal error page when factory.html cannot be loaded.
 * This should never happen in production if the build/deploy is correct.
 */
function getErrorHtml(attemptedPath: string, errorMessage: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>AI Agent Factory — Error</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #050a18; color: #e5e7eb; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .error-card { background: #0b1228; border: 1px solid #ef4444; border-radius: 12px; padding: 32px; max-width: 600px; width: 90%; }
    h1 { color: #ef4444; font-size: 20px; margin-bottom: 12px; }
    p { color: #8892b0; font-size: 14px; line-height: 1.6; margin-bottom: 8px; }
    code { background: #1a2a50; padding: 2px 8px; border-radius: 4px; font-size: 13px; color: #f59e0b; }
    .hint { margin-top: 16px; padding: 12px; background: rgba(245,158,11,0.1); border: 1px solid #f59e0b; border-radius: 8px; }
    .hint p { color: #f59e0b; margin: 0; }
  </style>
</head>
<body>
  <div class="error-card">
    <h1>&#9888; Factory UI Failed to Load</h1>
    <p>Could not read the Factory HTML file:</p>
    <p><code>${attemptedPath.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></p>
    <p>Error: <code>${errorMessage.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></p>
    <div class="hint">
      <p><strong>Fix:</strong> Ensure <code>src/views/factory.html</code> exists. If running from <code>dist/</code>, make sure the views folder was copied during build.</p>
    </div>
  </div>
</body>
</html>`;
}

// ── Route Handler ──────────────────────────────────────────────────────────

export function factoryPageHandler(_req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.send(loadFactoryHtml());
}

export default factoryPageHandler;
