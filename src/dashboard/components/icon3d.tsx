import { cn } from "../../components/ui/utils";

// ============================================================================
// 3D icon pack (assets/icon/3dicons-*-dynamic-color.png).
// Imported through Vite so each PNG is bundled into build/assets with the rest
// of the dashboard (works in dev AND prod — no extra static-serving config).
// Add new entries here as needed; keep the set small (these are heavy PNGs, so
// they're used only for prominent surfaces, not tiny inline affordances).
// ============================================================================

import overview from "../../../assets/icon/3dicons-chart-dynamic-color.png";
import chatbots from "../../../assets/icon/3dicons-chat-bubble-dynamic-color.png";
import surveillance from "../../../assets/icon/3dicons-target-dynamic-color.png";
import workers from "../../../assets/icon/3dicons-rocket-dynamic-color.png";
import conversations from "../../../assets/icon/3dicons-message-dynamic-color.png";
import infra from "../../../assets/icon/3dicons-computer-dynamic-color.png";
import shield from "../../../assets/icon/3dicons-shield-dynamic-color.png";
import key from "../../../assets/icon/3dicons-key-dynamic-color.png";
import settings from "../../../assets/icon/3dicons-setting-dynamic-color.png";
import rocket from "../../../assets/icon/3dicons-rocket-dynamic-color.png";

export const ICON3D = {
  overview,
  chatbots,
  surveillance,
  workers,
  conversations,
  infra,
  shield,
  key,
  settings,
  rocket,
} as const;

export type Icon3DName = keyof typeof ICON3D;

export function Icon3D({
  name,
  size = 20,
  className,
  alt = "",
}: {
  name: Icon3DName;
  size?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={ICON3D[name]}
      width={size}
      height={size}
      alt={alt}
      loading="lazy"
      draggable={false}
      className={cn("inline-block shrink-0 select-none object-contain", className)}
    />
  );
}
