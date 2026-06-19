import * as React from "react";
import { cn } from "../../components/ui/utils";

/**
 * GradientButton — premium gradient pill button (blue 500→600), focus ring,
 * hover elevation. Coherent with the shadcn dark theme.
 */
export function GradientButton({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-blue-500 to-blue-600 px-6 py-2 text-sm font-medium text-white shadow-lg shadow-blue-600/20 outline-none transition duration-200 hover:shadow-xl hover:shadow-blue-600/30 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-4",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * UtilityButton — small icon-only action with tooltip (title), tertiary look.
 * Replaces ad-hoc icon buttons across the dashboard.
 */
export function UtilityButton({
  icon: Icon,
  tooltip,
  className,
  tone = "default",
  ...props
}: React.ComponentProps<"button"> & {
  icon: React.ComponentType<any>;
  tooltip?: string;
  tone?: "default" | "danger";
}) {
  return (
    <button
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg border border-border bg-card/40 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        tone === "danger" && "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
        className,
      )}
      {...props}
    >
      <Icon className="size-4" />
    </button>
  );
}
