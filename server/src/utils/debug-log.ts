export type DebugLogData = Record<string, unknown>;

function isEnabled(): boolean {
  const v = process.env.CHAT_DEBUG;
  if (!v) return false;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes' || v.toLowerCase() === 'on';
}

function safeValue(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === 'string') {
    const max = Math.max(50, Math.min(2000, parseInt(process.env.CHAT_DEBUG_MAX_STR || '500', 10) || 500));
    if (v.length <= max) return v;
    return v.slice(0, max) + `…(+${v.length - max})`;
  }
  return v;
}

export function debugLog(event: string, data: DebugLogData = {}): void {
  if (!isEnabled()) return;

  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    event,
  };

  for (const [k, v] of Object.entries(data)) {
    payload[k] = safeValue(v);
  }

  // One-line JSON for easy grep
  console.log(JSON.stringify(payload));
}
