"use client";
import * as React from "react";
import { TRANSFORMATIONS, type SensitivityLevel, type Transformation } from "@workfonic/dataghost";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LevelBadge, pct } from "@/components/level-badge";
import type { PlaygroundActions, PlaygroundState } from "@/components/playground";

const LEVELS: SensitivityLevel[] = ["secret", "high", "medium", "low"];

export function PrivacyPanel({ state, actions }: { state: PlaygroundState; actions: PlaygroundActions }) {
  const report = state.report!;
  const fields = report.privacy.fields;
  const counts = Object.fromEntries(LEVELS.map((l) => [l, fields.filter((f) => f.level === l).length]));
  const plan = state.result?.transform;
  const planned = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of plan?.collections ?? []) for (const f of c.fields) m.set(`${c.name}.${f.path}`, f.transformation);
    return m;
  }, [plan]);

  return (
    <div className="space-y-4">
      <Alert variant="info">
        This page shows <strong>detection</strong>, not verified protection. Detection uses field names and value patterns and can miss personal data or flag fields that are not personal. Review every field before sharing output.
      </Alert>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {LEVELS.map((l) => (
          <Card key={l}>
            <CardContent className="py-3">
              <LevelBadge level={l} />
              <p className="mt-2 text-2xl font-semibold tabular-nums">{counts[l]}</p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="py-3">
            <span className="text-[11px] font-medium text-muted-foreground">needs review</span>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-warning">{report.totals.uncertainFields}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Potentially sensitive fields</CardTitle>
          <CardDescription>Transformations apply in Mask and Preserve modes. Credentials are always redacted, whatever is chosen. Relationship keys are pseudonymized consistently so references stay valid.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {fields.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No sensitive fields were detected. That does not prove the data contains none.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Field</TH>
                  <TH>Category</TH>
                  <TH>Level</TH>
                  <TH>Confidence</TH>
                  <TH>Why</TH>
                  <TH className="min-w-44">Transformation</TH>
                  {plan ? <TH>Last run</TH> : null}
                </TR>
              </THead>
              <TBody>
                {fields.map((f) => {
                  const key = `${f.collection}.${f.path}`;
                  const chosen = state.transformations[key];
                  return (
                    <TR key={key}>
                      <TD className="font-mono text-xs">{key}</TD>
                      <TD className="text-xs">{f.category}</TD>
                      <TD>
                        <LevelBadge level={f.level} uncertain={f.uncertain} />
                      </TD>
                      <TD className="text-xs tabular-nums">{pct(f.confidence)}</TD>
                      <TD className="max-w-80 whitespace-normal text-xs text-muted-foreground">
                        {f.reasons.join("; ")}
                        {f.warnings.length ? <span className="block text-warning">{f.warnings.join(" ")}</span> : null}
                      </TD>
                      <TD>
                        <Select aria-label={`Transformation for ${key}`} className="h-8 text-xs" value={chosen ?? ""} onChange={(e) => actions.setTransformation(key, e.target.value ? (e.target.value as Transformation) : null)}>
                          <option value="">default ({f.defaultTransformation})</option>
                          {TRANSFORMATIONS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </Select>
                      </TD>
                      {plan ? <TD className="text-xs">{planned.get(key) ?? "-"}</TD> : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {report.privacy.warnings.length ? (
        <Alert variant="warning">
          {report.privacy.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Limitations</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            {report.privacy.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
