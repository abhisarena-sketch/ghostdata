"use client";
import * as React from "react";
import { collectionFileName, type DataFormat } from "@workfonic/dataghost";
import { Download, FileJson } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { seedValue, type PlaygroundActions, type PlaygroundState } from "@/components/playground";
import { downloadText, formatBytes } from "@/lib/download";

const MIME: Record<DataFormat, string> = { json: "application/json", jsonl: "application/x-ndjson", csv: "text/csv" };

export function ExportPanel({ state, actions, onNavigate }: { state: PlaygroundState; actions: PlaygroundActions; onNavigate(tab: string): void }) {
  const [format, setFormat] = React.useState<DataFormat>("json");
  const [error, setError] = React.useState<string | null>(null);
  const result = state.result;
  const report = state.report!;
  const base = collectionFileName(state.source!.name.replace(/\.[^.]+$/, ""));

  /** One file per collection for JSONL and CSV; one file for JSON. */
  const files = React.useMemo(() => {
    if (!result) return [];
    const g = actions.ghost();
    const names = Object.keys(result.data);
    const suffix = result.mode === "synthetic" ? "synthetic" : result.mode === "mask" ? "masked" : "preserved";
    try {
      if (format === "json") {
        const data = names.length === 1 && names[0] === "records" ? result.data.records! : result.data;
        return [{ name: `${base}.${suffix}.json`, text: g.export(data, "json") }];
      }
      return names.map((n) => ({ name: `${names.length === 1 ? base : collectionFileName(n)}.${suffix}.${format}`, text: g.export(result.data[n]!, format) }));
    } catch (e) {
      setError((e as Error).message);
      return [];
    }
  }, [result, format, base, actions]);

  if (!result) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-6">
          <p className="text-sm text-muted-foreground">Run a generation first. Exports are built from the latest result.</p>
          <Button size="sm" onClick={() => onNavigate("generate")}>Go to Generate</Button>
        </CardContent>
      </Card>
    );
  }

  const config = {
    seed: seedValue(result.seed),
    ...actions.ghost().configFromInspection(report, { relationships: state.relationships, useDetectedRelationships: false, count: Object.fromEntries(Object.entries(result.data).map(([k, v]) => [k, v.length])) }),
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Download the result</CardTitle>
          <CardDescription>Files are created in this tab with a local download. CSV cells that start with =, +, - or @ are prefixed with an apostrophe so spreadsheets do not run them as formulas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="format">Format</Label>
              <Select id="format" value={format} onChange={(e) => setFormat(e.target.value as DataFormat)} className="w-40">
                <option value="json">JSON</option>
                <option value="jsonl">JSONL</option>
                <option value="csv">CSV</option>
              </Select>
            </div>
          </div>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <ul className="divide-y rounded-md border">
            {files.map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-3 px-3 py-2">
                <div>
                  <p className="font-mono text-sm">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(new TextEncoder().encode(f.text).length)}</p>
                </div>
                <Button size="sm" onClick={() => downloadText(f.name, f.text, MIME[format])}>
                  <Download aria-hidden />
                  Download
                </Button>
              </li>
            ))}
          </ul>
          {!result.validation.valid ? <Alert variant="warning">The last run did not pass every check. See the Generate tab before using these files.</Alert> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Reproduce it</CardTitle>
          <CardDescription>The config holds the seed, schemas, counts and relationships. Run it with the CLI to get the same output at any size.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" className="w-full justify-start" onClick={() => downloadText("dataghost.config.json", JSON.stringify(config, null, 2) + "\n", MIME.json)}>
            <FileJson aria-hidden />
            dataghost.config.json
          </Button>
          <Button variant="outline" className="w-full justify-start" onClick={() => downloadText(`${base}.inspection.json`, JSON.stringify(report, null, 2) + "\n", MIME.json)}>
            <FileJson aria-hidden />
            {base}.inspection.json
          </Button>
          <pre className="mt-2 overflow-x-auto rounded-md bg-secondary p-2 text-xs">dataghost generate --config dataghost.config.json</pre>
        </CardContent>
      </Card>
    </div>
  );
}
