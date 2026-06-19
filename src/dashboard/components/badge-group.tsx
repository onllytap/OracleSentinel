import * as React from "react";
import { cn } from "../../components/ui/utils";

/**
 * BadgeGroup — modern "addon + label" badge (pill with a leading highlighted
 * chip), styled with the shadcn dark tokens. Sizes: md | lg.
 */
export function BadgeGroup({
  addonText,
  children,
  size = "md",
  className,
}: {
  addonText: string;
  children: React.ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  const pad = size === "lg" ? "py-1.5 pl-1.5 pr-3 text-sm" : "py-1 pl-1 pr-2.5 text-xs";
  const chip = size === "lg" ? "px-2.5 py-0.5 text-xs" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 font-medium text-foreground",
        pad,
        className,
      )}
    >
      <span className={cn("rounded-full bg-primary font-semibold text-primary-foreground", chip)}>
        {addonText}
      </span>
      <span className="text-muted-foreground">{children}</span>
    </span>
  );
}
