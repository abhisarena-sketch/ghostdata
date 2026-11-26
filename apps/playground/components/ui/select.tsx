import * as React from "react";
import { cn } from "@/lib/utils";

/** Native select styled like shadcn/ui inputs (keyboard and screen-reader friendly by default). */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn("h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", className)}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
