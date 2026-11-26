"use client";
import * as React from "react";
import { prepareDataset, type RelationshipConfig, type RelationshipType } from "@workfonic/dataghost";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { pct } from "@/components/level-badge";
import type { PlaygroundActions, PlaygroundState } from "@/components/playground";

const TYPES: RelationshipType[] = ["many-to-one", "one-to-many", "one-to-one"];

function endpoint(e: RelationshipConfig["from"]): string {
  return typeof e === "string" ? e : `${e.collection}.${e.field}`;
}

export function RelationshipsPanel({ state, actions }: { state: PlaygroundState; actions: PlaygroundActions }) {
  const report = state.report!;
  const rels = state.relationships;
  const [error, setError] = React.useState<string | null>(null);

  // Top-level scalar fields can be keys; nested array items cannot.
  const paths = React.useMemo(
    () => report.collections.flatMap((c) => c.fields.filter((f) => f.type !== "object" && f.type !== "array" && !f.path.includes("[]")).map((f) => `${c.name}.${f.path}`)),
    [report],
  );

  function update(i: number, patch: Partial<RelationshipConfig>) {
    actions.setRelationships(rels.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function validate(next: RelationshipConfig[]) {
    try {
      // Prepare (without generating) to check endpoints, cardinality and cycles.
      const g = actions.ghost();
      prepareDataset(g.configFromInspection(report, { relationships: next, useDetectedRelationships: false }), g.registry, false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  React.useEffect(() => validate(rels), [rels]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Relationships used for generation</CardTitle>
            <CardDescription>
              Foreign keys are always drawn from generated parent keys, and integrity is checked after every run. A reference to the same collection builds an acyclic tree.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={paths.length < 2} onClick={() => actions.setRelationships([...rels, { from: paths[1]!, to: paths[0]!, type: "many-to-one" }])}>
            <Plus aria-hidden />
            Add
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rels.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No relationships. Collections will be generated independently.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Foreign key (from)</TH>
                  <TH>References (to)</TH>
                  <TH>Type</TH>
                  <TH>Nullable</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {rels.map((r, i) => (
                  <TR key={i}>
                    <TD>
                      <PathSelect label="From" paths={paths} value={endpoint(r.from)} onChange={(v) => update(i, { from: v })} />
                    </TD>
                    <TD>
                      <PathSelect label="To" paths={paths} value={endpoint(r.to)} onChange={(v) => update(i, { to: v })} />
                    </TD>
                    <TD>
                      <Select aria-label="Type" className="h-8 text-xs" value={r.type ?? "many-to-one"} onChange={(e) => update(i, { type: e.target.value as RelationshipType })}>
                        {TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </Select>
                    </TD>
                    <TD>
                      <input type="checkbox" aria-label="Nullable" className="size-4 accent-primary" checked={r.nullable === true} onChange={(e) => update(i, { nullable: e.target.checked })} />
                    </TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" aria-label="Remove relationship" onClick={() => actions.setRelationships(rels.filter((_, j) => j !== i))}>
                        <Trash2 aria-hidden />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Detected in the source</CardTitle>
          <CardDescription>Suggestions from field names and value overlap. Detection is a heuristic, so review each one.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {report.relationships.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No relationships detected.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>From</TH>
                  <TH>To</TH>
                  <TH>Type</TH>
                  <TH>Confidence</TH>
                  <TH>Coverage</TH>
                  <TH>Reason</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {report.relationships.map((s) => {
                  const used = rels.some((r) => endpoint(r.from) === s.from && endpoint(r.to) === s.to);
                  return (
                    <TR key={`${s.from}->${s.to}`}>
                      <TD className="font-mono text-xs">{s.from}</TD>
                      <TD className="font-mono text-xs">{s.to}</TD>
                      <TD className="text-xs">{s.type}</TD>
                      <TD className="text-xs tabular-nums">{pct(s.confidence)}</TD>
                      <TD className="text-xs tabular-nums">{pct(s.coverage)}</TD>
                      <TD className="max-w-80 whitespace-normal text-xs text-muted-foreground">{s.reason}</TD>
                      <TD className="text-right">
                        {used ? (
                          <Badge variant="default">in use</Badge>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => actions.setRelationships([...rels, { from: s.from, to: s.to, type: s.type, nullable: s.nullable }])}>
                            Use
                          </Button>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PathSelect({ label, paths, value, onChange }: { label: string; paths: string[]; value: string; onChange(v: string): void }) {
  return (
    <Select aria-label={label} className="h-8 font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      {paths.includes(value) ? null : <option value={value}>{value}</option>}
      {paths.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </Select>
  );
}
