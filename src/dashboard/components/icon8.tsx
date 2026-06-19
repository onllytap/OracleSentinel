import { cn } from "../../components/ui/utils";

// Icons8 (Fluency colour set). Free plan → attribution required (see footer).
// Using the official Icons8 CDN render endpoint.
export const ICON8 = {
  camera: "https://img.icons8.com/?id=DFlPW440Y2de&format=png&size=96",
  controlPanel: "https://img.icons8.com/?id=UD9nG7mgbuXZ&format=png&size=96",
} as const;

export type Icon8Name = keyof typeof ICON8;

export function Icon8({
  name,
  size = 20,
  className,
  alt = "",
}: {
  name: Icon8Name;
  size?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={ICON8[name]}
      width={size}
      height={size}
      alt={alt}
      loading="lazy"
      draggable={false}
      className={cn("inline-block select-none object-contain", className)}
    />
  );
}

export function Icons8Attribution({ className }: { className?: string }) {
  return (
    <a
      href="https://icons8.com"
      target="_blank"
      rel="noopener noreferrer"
      className={cn("text-[11px] text-muted-foreground hover:text-foreground", className)}
    >
      Icônes par Icons8
    </a>
  );
}
