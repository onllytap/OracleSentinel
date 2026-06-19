import { useMemo } from "react";
import { motion } from "motion/react";

// Hubs (relative coords in the 800×360 viewBox) — the agencies network.
const HUBS = [
  { x: 150, y: 120, label: "EU-West" },
  { x: 300, y: 90, label: "EU-Central" },
  { x: 470, y: 150, label: "MENA" },
  { x: 620, y: 110, label: "APAC" },
  { x: 250, y: 230, label: "Africa" },
  { x: 540, y: 250, label: "South" },
];

const ARCS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [1, 4],
  [2, 5],
  [0, 4],
];

function curve(ax: number, ay: number, bx: number, by: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2 - 60;
  return `M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`;
}

/**
 * WorldGrid — dependency-free animated "global monitoring" decoration.
 * A dotted field + animated connection arcs and pulsing hubs. Pure SVG + motion.
 */
export function WorldGrid({ className }: { className?: string }) {
  const dots = useMemo(() => {
    const out: { x: number; y: number; o: number }[] = [];
    for (let x = 20; x < 800; x += 22) {
      for (let y = 20; y < 360; y += 22) {
        // Organic-ish density: drop some dots pseudo-randomly.
        const seed = (x * 13 + y * 7) % 100;
        if (seed > 62) continue;
        out.push({ x, y, o: 0.06 + (seed % 10) / 90 });
      }
    }
    return out;
  }, []);

  return (
    <svg
      viewBox="0 0 800 360"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Réseau mondial des agences"
    >
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={1.6} fill="currentColor" opacity={d.o} />
      ))}

      {ARCS.map(([a, b], i) => {
        const path = curve(HUBS[a].x, HUBS[a].y, HUBS[b].x, HUBS[b].y);
        return (
          <g key={`arc-${i}`}>
            <path d={path} fill="none" stroke="url(#arcGrad)" strokeWidth={1.3} opacity={0.5} />
            <motion.circle
              r={2.6}
              fill="#60a5fa"
              initial={{ offsetDistance: "0%" }}
              animate={{ offsetDistance: "100%" }}
              transition={{ duration: 3 + i * 0.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.5 }}
              style={{ offsetPath: `path("${path}")` } as Record<string, string>}
            />
          </g>
        );
      })}

      {HUBS.map((h, i) => (
        <g key={`hub-${i}`}>
          <motion.circle
            cx={h.x}
            cy={h.y}
            r={6}
            fill="none"
            stroke="#60a5fa"
            strokeWidth={1.2}
            initial={{ scale: 0.6, opacity: 0.8 }}
            animate={{ scale: 2.4, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut", delay: i * 0.35 }}
            style={{ transformOrigin: `${h.x}px ${h.y}px` }}
          />
          <circle cx={h.x} cy={h.y} r={3} fill="#60a5fa" />
        </g>
      ))}

      <defs>
        <linearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.1" />
        </linearGradient>
      </defs>
    </svg>
  );
}
