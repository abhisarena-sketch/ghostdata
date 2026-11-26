"use client";
import * as React from "react";
import { flattenRecord, type DataRecord } from "@workfonic/dataghost";
import { CheckCircle2, Dices, Loader2, Play, XCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CollectionPicker } from "@/components/panels/inspector";
import { MAX_PLAYGROUND_RECORDS, seedValue, type Mode, type PlaygroundActions, type PlaygroundState } from "@/components/playground";

const MODES: { id: Mode; title: string; body: string }[] = [
  { id: "synthetic", title: "Synthetic", body: "Generate new records with the inferred schema. No source values are copied." },
  { id: "mask", title: "Mask", body: "Keep the source, replace fields detected as sensitive. Undetected fields are kept as they are." },
  { id: "preserve", title: "Preserve", body: "Keep keys, nesting, nulls, array lengths and formats. Replace every value." },
];

const PREVIEW_ROWS = 25;

export function GeneratePanel({ state, actions, onNavigate }: { state: PlaygroundState; actions: PlaygroundActions; onNavigate(tab: string): void }) {
  const report = state.report!;
  const largest = Math.max(...report.collections.map((c) => c.recordCount));
  const [mode, setMode] = React.useState<Mode>(state.result?.mode ?? "synthetic");
  const [count, setCount] = React.useState(String(Math.min(Math.max(largest, 100), MAX_PLAYGROUND_RECORDS)));
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const n = Number(count);
  const countError = mode === "synthetic" && (!Number.isInteger(n) || n < 1 || n > MAX_PLAYGROUND_RECORDS) ? `Enter a whole number from 1 to ${MAX_PLAYGROUND_RECORDS.toLocaleString("en-US")}.` : null;
  const seedError = state.seed.trim() === "" ? "Enter a seed." : state.seed.length > 64 ? "Use at most 64 characters." : null;

  async function run() {
    setError(null);
    setRunning(true);
    // Let the spinner paint before the (synchronous) engine work starts.
    await new Promise((r) => setTimeout(r, 30));
    const started = performance.now();
    try {
      const g = actions.ghost();
      const seed = seedValue(state.seed);
      const relationships = state.relationships;
      if (mode === "synthetic") {
        const out = await g.synthesize(state.source!.dataset, { overrides: state.overrides, count: n, relationships, useDetectedRelationships: false, seed });
        const schemas = Object.fromEntries(out.inspection.collections.map((c) => [c.name, c.schema]));
        actions.setResult({
          mode,
          seed: state.seed,
          data: out.data,
          integrity: out.report.integrity,
          validation: g.validateDataset(out.data, { schemas, relationships }),
          durationMs: performance.now() - started,
          generatorVersion: out.report.generatorVersion,
        });
      } else {
        const out = await g.transform(state.source!.dataset, mode, { overrides: state.overrides, relationships, transformations: state.transformations, seed });
        actions.setResult({
          mode,
          seed: state.seed,
          data: out.data,
          integrity: out.report.integrity,
          transform: out.report,
          validation: g.validateDataset(out.data, { relationships }),
          durationMs: performance.now() - started,
          generatorVersion: g.generatorVersion,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`rounded-lg border bg-card p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === m.id ? "border-primary ring-1 ring-primary" : "hover:border-input"}`}
          >
            <p className="text-sm font-semibold">{m.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{m.body}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="space-y-1">
            <Label htmlFor="seed">Seed</Label>
            <div className="flex gap-1">
              <Input id="seed" value={state.seed} onChange={(e) => actions.setSeed(e.target.value)} className="w-40 font-mono" maxLength={64} />
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                aria-label="New random seed"
                title="New random seed"
                onClick={() => actions.setSeed(String(crypto.getRandomValues(new Uint32Array(1))[0]))}
              >
                <Dices aria-hidden />
              </Button>
            </div>
          </div>
          {mode === "synthetic" ? (
            <div className="space-y-1">
              <Label htmlFor="count">Records in the largest collection</Label>
              <Input id="count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} className="w-44 tabular-nums" />
            </div>
          ) : (
            <p className="max-w-sm pb-2 text-xs text-muted-foreground">
              {mode === "mask" ? "Mask" : "Preserve"} keeps the source record count. Per-field transformations are set on the Privacy tab.
            </p>
          )}
          <Button onClick={run} disabled={running || !!countError || !!seedError}>
            {running ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
            {running ? "Running" : "Run"}
          </Button>
          {countError || seedError ? <p className="pb-2 text-xs text-destructive">{countError ?? seedError}</p> : null}
        </CardContent>
      </Card>

      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {state.result ? <Result state={state} onNavigate={onNavigate} /> : null}
    </div>
  );
}

function Result({ state, onNavigate }: { state: PlaygroundState; onNavigate(tab: string): void }) {
  const result = state.result!;
  const names = Object.keys(result.data);
  const [active, setActive] = React.useState(names[0]!);
  const records = result.data[active] ?? result.data[names[0]!] ?? [];
  const schemaErrors = Object.entries(result.validation.schema).flatMap(([c, v]) => v.errors.map((e) => ({ c, ...e })));
  const integrity = result.integrity;
  const safety = result.validation.safety;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Result</CardTitle>
            <CardDescription>
              {result.mode} · seed <span className="font-mono">{result.seed}</span> · generator {result.generatorVersion} · {Math.round(result.durationMs).toLocaleString("en-US")} ms
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => onNavigate("export")}>
            Export
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Check ok={integrity?.valid ?? true} title="Referential integrity" detail={integrity ? (integrity.valid ? `${integrity.stats.length} relationship(s) valid` : `${integrity.issues.length}${integrity.truncated ? "+" : ""} issue(s)`) : "no relationships"} />
          <Check ok={schemaErrors.length === 0} title="Schema validation" detail={result.mode === "synthetic" ? (schemaErrors.length ? `${schemaErrors.length} error(s)` : "all records match the schema") : "not applicable to masked output"} neutral={result.mode !== "synthetic"} />
          <Check ok={safety.length === 0} title="Safety scan" detail={safety.length ? `${safety.length}${result.validation.safetyTruncated ? "+" : ""} value(s) look real` : "no real-looking emails, IPs, cards or keys found"} />
        </CardContent>
      </Card>

      {integrity && !integrity.valid ? (
        <Alert variant="destructive">
          {integrity.issues.slice(0, 5).map((i, k) => (
            <p key={k}>{i.message}</p>
          ))}
        </Alert>
      ) : null}
      {schemaErrors.length ? (
        <Alert variant="warning">
          {schemaErrors.slice(0, 5).map((e, k) => (
            <p key={k}>
              {e.c}[{e.recordIndex}].{e.path}: {e.message}
            </p>
          ))}
        </Alert>
      ) : null}
      {safety.length ? (
        <Alert variant="warning">
          <p className="font-medium">These values look like real data. Review them before sharing the output.</p>
          {safety.slice(0, 8).map((f, k) => (
            <p key={k} className="font-mono text-xs">
              {f.location}: {f.message}
            </p>
          ))}
        </Alert>
      ) : null}
      {result.transform?.warnings.length ? (
        <Alert variant="info">
          {result.transform.warnings.slice(0, 8).map((w, k) => (
            <p key={k}>{w}</p>
          ))}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <CollectionPicker names={names} value={active} onChange={setActive} />
        <div className="flex flex-wrap gap-1">
          {names.map((c) => (
            <Badge key={c} variant="outline">
              {c}: {result.data[c]!.length.toLocaleString("en-US")}
            </Badge>
          ))}
        </div>
      </div>
      <Preview records={records} />
    </div>
  );
}

function Check({ ok, title, detail, neutral }: { ok: boolean; title: string; detail: string; neutral?: boolean }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-start gap-2">
      <Icon className={`mt-0.5 size-4 shrink-0 ${neutral ? "text-muted-foreground" : ok ? "text-primary" : "text-destructive"}`} aria-hidden />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function cell(v: unknown): React.ReactNode {
  if (v === null) return <span className="italic text-muted-foreground">null</span>;
  if (v === undefined) return <span className="text-muted-foreground">-</span>;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

export function Preview({ records }: { records: DataRecord[] }) {
  const rows = React.useMemo(() => records.slice(0, PREVIEW_ROWS).map((r) => flattenRecord(r)), [records]);
  const columns = React.useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r)))], [rows]);
  if (!records.length) return <p className="text-sm text-muted-foreground">No records.</p>;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <THead>
            <TR>
              {columns.map((c) => (
                <TH key={c} className="font-mono">
                  {c}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={i}>
                {columns.map((c) => (
                  <TD key={c} className="whitespace-nowrap font-mono text-xs">
                    {cell(r[c])}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
        {records.length > PREVIEW_ROWS ? (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Showing {PREVIEW_ROWS} of {records.length.toLocaleString("en-US")} records.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
