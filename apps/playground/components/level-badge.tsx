import type { SensitivityLevel } from "@workfonic/dataghost";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<SensitivityLevel, "secret" | "high" | "medium" | "low" | "outline"> = {
  secret: "secret",
  high: "high",
  medium: "medium",
  low: "low",
  none: "outline",
};

export function LevelBadge({ level, uncertain }: { level: SensitivityLevel; uncertain?: boolean }) {
  return (
    <Badge variant={VARIANT[level]} title={uncertain ? "Low-confidence detection: review this field" : undefined}>
      {level}
      {uncertain ? "?" : ""}
    </Badge>
  );
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
