import type * as React from "react";
import { cn } from "../lib/utils";

// Copied from Holotable src/components/ui/card.tsx (unchanged apart from the import path).

export function Card({ className, ...props }: React.ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface shadow-(--shadow-card)", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-between px-4 py-3", className)} {...props} />;
}

export function CardTitle({
  className,
  as: Heading = "h2",
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" | "h4" }) {
  return <Heading className={cn("text-sm font-semibold", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}
