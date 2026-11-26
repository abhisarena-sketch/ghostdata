"use client";
import * as React from "react";
import type { FieldInput, InferredField } from "@workfonic/dataghost";
import { RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LevelBadge, pct } from "@/components/level-badge";
import type { PlaygroundActions, PlaygroundState } from "@/components/playground";

const MAX_OPTIONS_CHARS = 10_000;

export function CollectionPicker({ names, value, onChange }: { names: string[]; value: string; onChange(v: string): void }) {
  if (names.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label="Collection">
      {names.map((n) => (
        <Button key={n} size="sm" variant={n === value ? "default" : "outline"} onClick={() => onChange(n)} role="tab" aria-selected={n === value}>
          {n}
        </Button>
      ))}
    </div>
  );
}

export function InspectorPanel({ state, actions }: { state: PlaygroundState; actions: PlaygroundActions }) {
  const report = state.report!;
  const names = report.collections.map((c) => c.name);
  const [active, setActive] = React.useState(names[0]!);
  const collection = report.collections.find((c) => c.name === active) ?? report.collections[0]!;
  const generators = React.useMemo(() => actions.ghost().generators(), [actions]);
  const [error, setError] = React.useState<string | null>(null);
  const [showSchema, setShowSchema] = React.useState(false);

  const grouped = React.useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of generators) m.set(g.category, [...(m.get(g.category) ?? []), g.name]);
    return [...m.entries()];
  }, [generators]);

  function apply(path: string, value: FieldInput | null) {
    setError(actions.setOverride(collection.name, path, value));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CollectionPicker names={names} value={collection.name} onChange={setActive} />
        <p className="text-xs text-muted-foreground">Examples show structure only (for example Xxxx-999), never source values.</p>
      </div>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {collection.warnings.length ? <Alert variant="warning">{collection.warnings.join(" ")}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>
            {collection.name} <span className="font-normal text-muted-foreground">· {collection.recordCount.toLocaleString("en-US")} records</span>
          </CardTitle>
          <CardDescription>Change a field&apos;s generator to override what was inferred. Options are JSON and are parsed, never executed.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Field</TH>
                <TH>Type</TH>
                <TH>Detected as</TH>
                <TH>Nulls</TH>
                <TH>Example</TH>
                <TH>Privacy</TH>
                <TH className="min-w-48">Generator</TH>
                <TH className="min-w-56">Options (JSON)</TH>
              </TR>
            </THead>
            <TBody>
              {collection.fields.map((f) => (
                <FieldRow key={f.path} field={f} override={state.overrides[collection.name]?.[f.path]} grouped={grouped} onApply={apply} />
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <div>
        <Button variant="ghost" size="sm" onClick={() => setShowSchema((s) => !s)}>
          {showSchema ? "Hide" : "Show"} the generation schema
        </Button>
        {showSchema ? <pre className="mt-2 max-h-96 overflow-auto rounded-md border bg-background p-3 text-xs">{JSON.stringify(collection.schema, null, 2)}</pre> : null}
      </div>
    </div>
  );
}

function splitOverride(o: FieldInput | undefined): { type?: string; options: Record<string, unknown> } {
  if (typeof o === "string") return { type: o, options: {} };
  if (o && typeof o === "object" && typeof (o as { type?: unknown }).type === "string") {
    const { type, ...options } = o as Record<string, unknown>;
    return { type: type as string, options };
  }
  return { options: {} };
}

function FieldRow({ field, override, grouped, onApply }: { field: InferredField; override?: FieldInput; grouped: [string, string[]][]; onApply(path: string, v: FieldInput | null): void }) {
  const structural = field.type === "object" || (field.type === "array" && !field.suggestedGenerator);
  const ov = splitOverride(override);
  const type = ov.type ?? field.suggestedGenerator?.type ?? "";
  const options = ov.type ? ov.options : (field.suggestedGenerator?.options ?? {});
  const optionsText = Object.keys(options).length ? JSON.stringify(options) : "";
  const [draft, setDraft] = React.useState(optionsText);
  const [optError, setOptError] = React.useState<string | null>(null);
  React.useEffect(() => setDraft(optionsText), [optionsText]);

  function commitOptions() {
    if (draft === optionsText) return;
    setOptError(null);
    let parsed: unknown = {};
    if (draft.trim()) {
      if (draft.length > MAX_OPTIONS_CHARS) return setOptError("Options are limited to 10,000 characters.");
      try {
        parsed = JSON.parse(draft);
      } catch {
        return setOptError("Not valid JSON.");
      }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return setOptError("Options must be a JSON object.");
    if ("type" in parsed) return setOptError('Choose the generator in the list, not with "type".');
    onApply(field.path, { type, ...(parsed as Record<string, unknown>) });
  }

  const depth = field.path.split(".").length - 1;
  return (
    <TR className={field.overridden ? "bg-accent/40" : undefined}>
      <TD className="font-mono text-xs" style={{ paddingLeft: `${0.75 + depth * 0.75}rem` }}>
        {field.path}
        {field.warnings.length ? <p className="mt-0.5 max-w-64 whitespace-normal font-sans text-[11px] text-warning">{field.warnings.join(" ")}</p> : null}
      </TD>
      <TD className="text-xs">{field.type}</TD>
      <TD className="text-xs">
        {field.semanticType ? (
          <span>
            {field.semanticType} <span className="text-muted-foreground">{pct(field.confidence)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TD>
      <TD className="text-xs tabular-nums">{field.nullable ? pct(field.nullRate) : <span className="text-muted-foreground">0%</span>}</TD>
      <TD className="max-w-40 truncate font-mono text-xs text-muted-foreground" title={field.example}>{field.example}</TD>
      <TD>{field.privacy && field.privacy.level !== "none" ? <LevelBadge level={field.privacy.level} uncertain={field.privacy.uncertain} /> : <Badge variant="outline">none</Badge>}</TD>
      <TD>
        {structural ? (
          <span className="text-xs text-muted-foreground">nested</span>
        ) : (
          <div className="flex items-center gap-1">
            <Select aria-label={`Generator for ${field.path}`} value={type} onChange={(e) => onApply(field.path, e.target.value === field.suggestedGenerator?.type ? null : { type: e.target.value })} className="h-8 text-xs">
              {grouped.map(([cat, names]) => (
                <optgroup key={cat} label={cat}>
                  {names.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
            {field.overridden ? (
              <Button variant="ghost" size="icon" aria-label="Reset to inferred" title="Reset to inferred" onClick={() => onApply(field.path, null)}>
                <RotateCcw aria-hidden />
              </Button>
            ) : null}
          </div>
        )}
      </TD>
      <TD>
        {structural ? null : (
          <>
            <Input aria-label={`Options for ${field.path}`} value={draft} placeholder="{}" onChange={(e) => setDraft(e.target.value)} onBlur={commitOptions} onKeyDown={(e) => e.key === "Enter" && commitOptions()} className="h-8 font-mono text-xs" />
            {optError ? <p className="mt-0.5 text-[11px] text-destructive">{optError}</p> : null}
          </>
        )}
      </TD>
    </TR>
  );
}
