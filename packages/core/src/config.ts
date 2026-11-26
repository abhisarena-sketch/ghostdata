import { z } from "zod";
import { TRANSFORMATIONS } from "@workfonic/dataghost-privacy";
import { ConfigError } from "./errors.js";

const endpoint = z.union([z.string().min(3).max(300), z.object({ collection: z.string().min(1), field: z.string().min(1) }).strict()]);

export const relationshipSchema = z
  .object({
    name: z.string().max(200).optional(),
    from: endpoint,
    to: endpoint,
    type: z.enum(["many-to-one", "one-to-one", "one-to-many"]).optional(),
    nullable: z.union([z.boolean(), z.number().min(0).max(1)]).optional(),
    minChildren: z.number().int().min(0).optional(),
    maxChildren: z.number().int().min(1).optional(),
    selfReference: z.enum(["tree", "any"]).optional(),
    deferred: z.boolean().optional(),
  })
  .strict();

const seed = z.union([z.number().int().safe(), z.string().min(1).max(200)]);

/**
 * The dataghost.config.json format shared by the CLI, SDK and playground.
 * Functions cannot be expressed here: custom function generators are SDK-only.
 */
export const fileConfigSchema = z
  .object({
    $schema: z.string().optional(),
    seed: seed.optional(),
    referenceDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date").optional(),
    mode: z.enum(["synthetic", "mask", "preserve"]).optional(),
    output: z
      .object({
        dir: z.string().min(1).max(500).optional(),
        format: z.enum(["json", "jsonl", "csv"]).optional(),
        pretty: z.boolean().optional(),
      })
      .strict()
      .optional(),
    collections: z
      .record(
        z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/, "collection names must be letters, digits, _ or -"),
        z.object({ count: z.number().int().min(0).optional(), schema: z.record(z.string(), z.unknown()).optional() }).strict(),
      )
      .optional(),
    relationships: z.array(relationshipSchema).max(500).optional(),
    overrides: z.record(z.string(), z.unknown()).optional(),
    transformations: z.record(z.string(), z.enum(TRANSFORMATIONS as [string, ...string[]])).optional(),
    keep: z.array(z.string()).optional(),
    detectRelationships: z.boolean().optional(),
    limits: z.object({ maxInputMB: z.number().positive().max(10_000).optional() }).strict().optional(),
  })
  .strict();

export type FileConfig = z.infer<typeof fileConfigSchema>;

/** Validate a parsed config object, producing readable error messages. */
export function parseConfig(value: unknown): FileConfig {
  const r = fileConfigSchema.safeParse(value);
  if (!r.success) {
    const details = r.error.issues.map((i) => {
      const where = i.path.length ? i.path.join(".") : "(root)";
      if (i.code === "unrecognized_keys") return `${where}: unknown key(s) ${i.keys.map((k) => `"${k}"`).join(", ")}`;
      return `${where}: ${i.message}`;
    });
    throw new ConfigError(`Invalid configuration: ${details.join("; ")}`, details);
  }
  return r.data;
}

/** A starter config written by `dataghost init`. */
export const STARTER_CONFIG: FileConfig = {
  seed: 12345,
  mode: "synthetic",
  output: { dir: "dataghost-output", format: "json", pretty: true },
  collections: {
    departments: {
      count: 5,
      schema: {
        departmentId: { type: "sequence", prefix: "DEPT-", pad: 2 },
        name: "department",
      },
    },
    employees: {
      count: 50,
      schema: {
        employeeId: { type: "employeeId", prefix: "EMP-", pad: 4 },
        firstName: "firstName",
        lastName: "lastName",
        email: "email",
        phone: { type: "phone", country: "US" },
        departmentId: "string",
        managerId: { type: "string", nullable: 0.05 },
        jobTitle: "jobTitle",
        salary: { type: "salary", min: 45000, max: 160000 },
        joiningDate: "joiningDate",
        status: "employmentStatus",
        address: { type: "address", format: "object" },
      },
    },
  },
  relationships: [
    { from: "employees.departmentId", to: "departments.departmentId" },
    { from: "employees.managerId", to: "employees.employeeId", selfReference: "tree" },
  ],
};
