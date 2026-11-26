"use client";
import * as React from "react";
import { FileUp, FlaskConical, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MAX_IMPORT_BYTES, type PlaygroundActions, type PlaygroundState } from "@/components/playground";
import { formatBytes } from "@/lib/download";
import { SAMPLE_NAME, SAMPLE_TEXT } from "@/lib/sample";

const ACCEPT = ".json,.jsonl,.ndjson,.csv,application/json,text/csv";

export function DashboardPanel({ state, actions, loadError, onNavigate }: { state: PlaygroundState; actions: PlaygroundActions; loadError: string | null; onNavigate(tab: string): void }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);

  async function readFile(file: File) {
    setFileError(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError(`${file.name} is ${formatBytes(file.size)}. The playground accepts files up to ${formatBytes(MAX_IMPORT_BYTES)}; use the CLI for larger files.`);
      return;
    }
    if (!/\.(json|jsonl|ndjson|csv)$/i.test(file.name)) {
      setFileError("Choose a .json, .jsonl, .ndjson or .csv file. ZIP archives are not supported.");
      return;
    }
    actions.load(file.name, await file.text(), file.size);
  }

  const { source, report } = state;
  const error = fileError ?? loadError ?? state.reportError;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Import a dataset</CardTitle>
          <CardDescription>JSON (an array, or an object of collections), JSONL or CSV, up to {formatBytes(MAX_IMPORT_BYTES)}. The file is read in this tab and never uploaded.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a file to import"
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) void readFile(f);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-10 text-center transition-colors ${dragging ? "border-primary bg-accent" : "hover:bg-secondary/60"}`}
          >
            <FileUp className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Drop a file here, or click to choose one</p>
            <p className="text-xs text-muted-foreground">.json, .jsonl, .ndjson, .csv</p>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => actions.load(SAMPLE_NAME, SAMPLE_TEXT, SAMPLE_TEXT.length)}>
              <FlaskConical aria-hidden />
              Load the fictional sample
            </Button>
            {source ? (
              <Button variant="ghost" onClick={actions.clear}>
                <Trash2 aria-hidden />
                Clear
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">The sample is a made-up company with departments, employees and a manager hierarchy.</span>
          </div>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
            <li><span className="text-foreground">Inspect</span> infers types, meaning and privacy level for each field.</li>
            <li><span className="text-foreground">Relationships</span> lists detected keys between collections. Review them.</li>
            <li><span className="text-foreground">Generate</span> creates synthetic data, or masks or preserves the source.</li>
            <li><span className="text-foreground">Export</span> downloads JSON, JSONL or CSV.</li>
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">The same seed, input and settings give the same output. Custom generator code is only available in the SDK, never in the browser.</p>
        </CardContent>
      </Card>

      {source && report ? (
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>{source.name}</CardTitle>
              <CardDescription>{formatBytes(source.bytes)} · inspected locally</CardDescription>
            </div>
            <Button size="sm" onClick={() => onNavigate("generate")}>Generate</Button>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <Stat label="Collections" value={report.totals.collections} />
              <Stat label="Records" value={report.totals.records} />
              <Stat label="Fields" value={report.totals.fields} />
              <Stat label="Sensitive fields" value={report.totals.sensitiveFields} tone={report.totals.sensitiveFields ? "warn" : undefined} />
              <Stat label="Relationships" value={report.relationships.length} />
            </dl>
            <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {report.collections.map((c) => (
                <div key={c.name} className="rounded-md border px-3 py-2">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.recordCount.toLocaleString("en-US")} records · {c.fieldCount} fields
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-warning" : ""}`}>{value.toLocaleString("en-US")}</dd>
    </div>
  );
}
