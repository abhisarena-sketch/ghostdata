"use client";
import * as React from "react";
import {
  DataGhost,
  normalizeSchema,
  type Dataset,
  type DatasetValidation,
  type FieldInput,
  type InspectionReport,
  type IntegrityReport,
  type RelationshipConfig,
  type TransformReport,
  type Transformation,
} from "@workfonic/dataghost";
import { Database, Download, FileSearch, GitFork, LayoutDashboard, ShieldCheck, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardPanel } from "@/components/panels/dashboard";
import { InspectorPanel } from "@/components/panels/inspector";
import { RelationshipsPanel } from "@/components/panels/relationships";
import { GeneratePanel } from "@/components/panels/generate";
import { PrivacyPanel } from "@/components/panels/privacy";
import { ExportPanel } from "@/components/panels/export";

/** Import limit for the browser. Larger files belong in the CLI, which streams. */
export const MAX_IMPORT_BYTES = 10 * 1048576;
/** Cap per run so the tab stays responsive. */
export const MAX_PLAYGROUND_RECORDS = 50_000;

export type Mode = "synthetic" | "mask" | "preserve";

export interface Source {
  name: string;
  bytes: number;
  dataset: Dataset;
}

export interface RunResult {
  mode: Mode;
  seed: string;
  data: Dataset;
  integrity?: IntegrityReport;
  validation: DatasetValidation;
  transform?: TransformReport;
  durationMs: number;
  generatorVersion: string;
}

export type Overrides = Record<string, Record<string, FieldInput>>;

export interface PlaygroundState {
  source: Source | null;
  report: InspectionReport | null;
  reportError: string | null;
  overrides: Overrides;
  relationships: RelationshipConfig[];
  transformations: Record<string, Transformation>;
  seed: string;
  result: RunResult | null;
}

export interface PlaygroundActions {
  load(name: string, text: string, bytes: number): void;
  clear(): void;
  /** Returns an error message (and changes nothing) when the override is invalid. */
  setOverride(collection: string, path: string, value: FieldInput | null): string | null;
  setRelationships(r: RelationshipConfig[]): void;
  setTransformation(key: string, t: Transformation | null): void;
  setSeed(seed: string): void;
  setResult(r: RunResult | null): void;
  ghost(seed?: string): DataGhost;
}

export function seedValue(seed: string): string | number {
  const t = seed.trim();
  return /^\d{1,15}$/.test(t) ? Number(t) : t;
}

export function Playground() {
  const [source, setSource] = React.useState<Source | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [overrides, setOverrides] = React.useState<Overrides>({});
  const [relationships, setRelationships] = React.useState<RelationshipConfig[]>([]);
  const [transformations, setTransformations] = React.useState<Record<string, Transformation>>({});
  const [seed, setSeed] = React.useState("12345");
  const [result, setResult] = React.useState<RunResult | null>(null);
  const [tab, setTab] = React.useState("dashboard");

  const ghost = React.useCallback((s?: string) => new DataGhost({ seed: seedValue(s ?? seed) }), [seed]);

  const { report, reportError } = React.useMemo(() => {
    if (!source) return { report: null, reportError: null };
    try {
      return { report: ghost().inspect(source.dataset, { overrides }), reportError: null };
    } catch (e) {
      return { report: null, reportError: (e as Error).message };
    }
    // The inspection does not depend on the seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, overrides]);

  const actions: PlaygroundActions = {
    load(name, text, bytes) {
      setLoadError(null);
      try {
        const dataset = ghost().parse(text, name, { name: name.replace(/\.[^.]+$/, ""), maxBytes: MAX_IMPORT_BYTES });
        const inspection = ghost().inspect(dataset);
        setSource({ name, bytes, dataset });
        setOverrides({});
        setTransformations({});
        setResult(null);
        setRelationships(inspection.relationships.map(({ name: n, from, to, type, nullable, selfReference }) => ({ name: n, from, to, type, nullable, selfReference })));
        setTab("inspector");
      } catch (e) {
        setLoadError((e as Error).message);
      }
    },
    clear() {
      setSource(null);
      setResult(null);
      setOverrides({});
      setRelationships([]);
      setTransformations({});
      setTab("dashboard");
    },
    setOverride(collection, path, value) {
      const next: Overrides = { ...overrides, [collection]: { ...(overrides[collection] ?? {}) } };
      if (value === null) delete next[collection]![path];
      else next[collection]![path] = value;
      if (source) {
        try {
          const g = ghost();
          for (const c of g.inspect(source.dataset, { overrides: next }).collections) normalizeSchema(c.schema, { registry: g.registry });
        } catch (e) {
          return (e as Error).message;
        }
      }
      setResult(null);
      setOverrides(next);
      return null;
    },
    setRelationships(r) {
      setResult(null);
      setRelationships(r);
    },
    setTransformation(key, t) {
      setResult(null);
      setTransformations((m) => {
        const next = { ...m };
        if (t === null) delete next[key];
        else next[key] = t;
        return next;
      });
    },
    setSeed,
    setResult,
    ghost,
  };

  const state: PlaygroundState = { source, report, reportError, overrides, relationships, transformations, seed, result };
  const ready = !!source && !!report;

  return (
    <div className="min-h-screen bg-secondary/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Database className="size-4" aria-hidden />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight">DataGhost Playground</h1>
              <p className="text-xs text-muted-foreground">Realistic test data. Zero real identities.</p>
            </div>
          </div>
          <p className="hidden text-xs text-muted-foreground md:block">Runs locally in this tab. Nothing is uploaded and nothing is tracked.</p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-6">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto">
            <TabsList className="min-w-max">
              <TabsTrigger value="dashboard"><LayoutDashboard aria-hidden />Dashboard</TabsTrigger>
              <TabsTrigger value="inspector" disabled={!ready}><FileSearch aria-hidden />Inspector</TabsTrigger>
              <TabsTrigger value="relationships" disabled={!ready}><GitFork aria-hidden />Relationships</TabsTrigger>
              <TabsTrigger value="generate" disabled={!ready}><Sparkles aria-hidden />Generate</TabsTrigger>
              <TabsTrigger value="privacy" disabled={!ready}><ShieldCheck aria-hidden />Privacy</TabsTrigger>
              <TabsTrigger value="export" disabled={!ready}><Download aria-hidden />Export</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="dashboard">
            <DashboardPanel state={state} actions={actions} loadError={loadError} onNavigate={setTab} />
          </TabsContent>
          {ready ? (
            <>
              <TabsContent value="inspector"><InspectorPanel state={state} actions={actions} /></TabsContent>
              <TabsContent value="relationships"><RelationshipsPanel state={state} actions={actions} /></TabsContent>
              <TabsContent value="generate"><GeneratePanel state={state} actions={actions} onNavigate={setTab} /></TabsContent>
              <TabsContent value="privacy"><PrivacyPanel state={state} actions={actions} /></TabsContent>
              <TabsContent value="export"><ExportPanel state={state} actions={actions} onNavigate={setTab} /></TabsContent>
            </>
          ) : null}
        </Tabs>
      </main>
    </div>
  );
}
