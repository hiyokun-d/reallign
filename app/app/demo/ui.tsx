// Tiny UI kit for /demo only. The demo is sealed off from the rest of the app
// (enforced in eslint.config.mjs), so it can't use components/ui.

import type { ComponentProps } from "react";

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl border bg-card p-4 text-card-foreground", className)} {...props} />;
}

export function DemoButton({
  variant = "solid",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: "solid" | "outline" }) {
  return (
    <button
      className={cx(
        "inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50",
        variant === "solid"
          ? "bg-primary text-primary-foreground hover:bg-primary/85"
          : "border bg-background hover:bg-muted",
        className
      )}
      {...props}
    />
  );
}

export function Pill({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        on ? "bg-primary text-primary-foreground" : "border text-muted-foreground"
      )}
    >
      <span className={cx("size-1.5 rounded-full", on ? "bg-primary-foreground" : "bg-muted-foreground")} />
      {children}
    </span>
  );
}

export { cx };
