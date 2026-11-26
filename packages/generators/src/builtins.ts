import { z } from "zod";
import {
  COMPANY_CORES,
  COMPANY_PREFIXES,
  COMPANY_SUFFIXES,
  COUNTRIES,
  CURRENCIES,
  DEPARTMENTS,
  DESIGNATIONS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_WEIGHTS,
  FIRST_NAMES,
  GENERIC_STATUSES,
  LAST_NAMES,
  SAFE_EMAIL_DOMAINS,
  SAFE_URL_DOMAINS,
  STREET_NAMES,
  STREET_SUFFIXES,
  URL_PATHS,
  WORDS,
  type CountryInfo,
} from "./data.js";
import { compilePattern, type CompiledPattern } from "./pattern.js";
import type { Rng } from "./rng.js";
import type { GeneratorContext, GeneratorDefinition } from "./types.js";
import {
  addDays,
  formatDate,
  isValidDateInput,
  pad,
  randomDateBetween,
  resolveDate,
  roundTo,
  sampleNumber,
  slugify,
} from "./util.js";

// ---------------------------------------------------------------------------
// Option helpers
// ---------------------------------------------------------------------------

const none = z.object({}).strict();
const dateInput = z
  .union([z.string(), z.number()])
  .refine(isValidDateInput, { message: 'expected an ISO date, epoch milliseconds, "now" or an offset like "-5y"' });
const distribution = z.enum(["uniform", "normal", "exponential"]);
const countryCode = z.string().length(2).toUpperCase();

function def<S extends z.ZodTypeAny>(
  d: Omit<GeneratorDefinition<z.output<S>>, "options"> & { options: S },
): GeneratorDefinition<z.output<S>> {
  return d as unknown as GeneratorDefinition<z.output<S>>;
}

function countryFor(rng: Rng, code?: string): CountryInfo {
  if (code) {
    const found = COUNTRIES.find((c) => c.code === code);
    if (found) return found;
  }
  return rng.pick(COUNTRIES);
}

function fromShape(rng: Rng, shape: string): string {
  let out = "";
  for (const ch of shape) {
    if (ch === "9") out += String(rng.int(0, 9));
    else if (ch === "A") out += String.fromCharCode(65 + rng.int(0, 25));
    else if (ch === "a") out += String.fromCharCode(97 + rng.int(0, 25));
    else out += ch;
  }
  return out;
}

function siblingString(ctx: GeneratorContext, keys: string[]): string | undefined {
  for (const [k, v] of Object.entries(ctx.siblings)) {
    if (typeof v !== "string" || v.length === 0) continue;
    const norm = k.toLowerCase().replace(/[^a-z]/g, "");
    if (keys.includes(norm)) return v;
  }
  return undefined;
}

/** Find the most likely name parts among sibling fields, so emails/usernames match names. */
function siblingName(ctx: GeneratorContext): { first?: string; last?: string } {
  const first = siblingString(ctx, ["firstname", "givenname", "fname", "forename"]);
  const last = siblingString(ctx, ["lastname", "surname", "familyname", "lname"]);
  if (first || last) return { first, last };
  const full = siblingString(ctx, ["name", "fullname", "displayname", "employeename", "customername", "username"]);
  if (full && /\s/.test(full)) {
    const parts = full.trim().split(/\s+/);
    return { first: parts[0], last: parts[parts.length - 1] };
  }
  return {};
}

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const patternCache = new Map<string, CompiledPattern>();
function getPattern(source: string): CompiledPattern {
  let p = patternCache.get(source);
  if (!p) {
    p = compilePattern(source);
    if (patternCache.size > 500) patternCache.clear();
    patternCache.set(source, p);
  }
  return p;
}

function uuidFromRng(rng: Rng): string {
  const h = rng.hex(32).split("");
  h[12] = "4";
  h[16] = "89ab"[rng.int(0, 3)] as string;
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Personal
// ---------------------------------------------------------------------------

const personal: GeneratorDefinition<any>[] = [
  def({
    name: "firstName",
    category: "personal",
    description: "A given name from a diverse international list.",
    output: "string",
    options: none,
    generate: (ctx) => ctx.rng.pick(FIRST_NAMES),
  }),
  def({
    name: "lastName",
    category: "personal",
    description: "A family name from a diverse international list.",
    output: "string",
    options: none,
    generate: (ctx) => ctx.rng.pick(LAST_NAMES),
  }),
  def({
    name: "fullName",
    category: "personal",
    description: "First and last name. Reuses sibling firstName/lastName fields when present.",
    output: "string",
    options: none,
    generate: (ctx) => {
      const n = siblingName(ctx);
      return `${n.first ?? ctx.rng.pick(FIRST_NAMES)} ${n.last ?? ctx.rng.pick(LAST_NAMES)}`;
    },
  }),
  def({
    name: "email",
    category: "personal",
    description: "An email address on a reserved test domain (RFC 2606), derived from sibling name fields when present.",
    output: "string",
    options: z
      .object({
        domain: z
          .string()
          .regex(/^(?:[a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|example|invalid|localhost))$/i, {
            message: "domain must be a reserved test domain (example.com/.org/.net or *.test, *.example, *.invalid, *.localhost)",
          })
          .optional(),
      })
      .strict(),
    generate: (ctx, o) => {
      const n = siblingName(ctx);
      const first = slugify(n.first ?? ctx.rng.pick(FIRST_NAMES));
      const last = slugify(n.last ?? ctx.rng.pick(LAST_NAMES));
      const style = ctx.rng.int(0, 3);
      const local =
        style === 0 ? `${first}.${last}` : style === 1 ? `${first[0]}${last}` : style === 2 ? `${first}${last[0]}` : `${first}_${last}`;
      const suffix = ctx.rng.bool(0.4) ? String(ctx.rng.int(1, 999)) : "";
      return `${local}${suffix}@${o.domain ?? ctx.rng.pick(SAFE_EMAIL_DOMAINS)}`;
    },
  }),
  def({
    name: "phone",
    category: "personal",
    description:
      "A phone number from fictional/reserved ranges: US 555-0100..0199 (NANP fictional) or UK 07700 900000..900999 (Ofcom drama range).",
    output: "string",
    options: z
      .object({
        country: z.enum(["US", "GB"]).optional(),
        format: z.enum(["international", "national", "e164"]).default("international"),
      })
      .strict(),
    generate: (ctx, o) => {
      const country = o.country ?? (ctx.rng.bool(0.7) ? "US" : "GB");
      if (country === "US") {
        const area = ctx.rng.pick(["202", "212", "312", "415", "512", "617", "206", "303"]);
        const line = `01${pad(ctx.rng.int(0, 99), 2)}`;
        if (o.format === "e164") return `+1${area}555${line}`;
        if (o.format === "national") return `(${area}) 555-${line}`;
        return `+1 ${area}-555-${line}`;
      }
      const tail = pad(ctx.rng.int(0, 999), 3);
      if (o.format === "e164") return `+447700900${tail}`;
      if (o.format === "national") return `07700 900${tail}`;
      return `+44 7700 900${tail}`;
    },
  }),
  def({
    name: "street",
    category: "personal",
    description: "A street line such as \"42 Maple Avenue\".",
    output: "string",
    options: none,
    generate: (ctx) => `${ctx.rng.int(1, 9999)} ${ctx.rng.pick(STREET_NAMES)} ${ctx.rng.pick(STREET_SUFFIXES)}`,
  }),
  def({
    name: "city",
    category: "personal",
    description: "A plausible (often fictional) city name.",
    output: "string",
    options: z.object({ country: countryCode.optional() }).strict(),
    generate: (ctx, o) => ctx.rng.pick(countryFor(ctx.rng, o.country).cities),
  }),
  def({
    name: "country",
    category: "personal",
    description: "A country name.",
    output: "string",
    options: none,
    generate: (ctx) => ctx.rng.pick(COUNTRIES).name,
  }),
  def({
    name: "countryCode",
    category: "personal",
    description: "An ISO 3166-1 alpha-2 country code.",
    output: "string",
    options: none,
    generate: (ctx) => ctx.rng.pick(COUNTRIES).code,
  }),
  def({
    name: "postalCode",
    category: "personal",
    description: "A postal code in the country's format (random digits/letters).",
    output: "string",
    options: z.object({ country: countryCode.optional(), shape: z.string().max(20).optional() }).strict(),
    generate: (ctx, o) => fromShape(ctx.rng, o.shape ?? countryFor(ctx.rng, o.country).postal),
  }),
  def({
    name: "address",
    category: "personal",
    description: "A full postal address, as a single string or an object.",
    output: "any",
    options: z.object({ country: countryCode.optional(), format: z.enum(["string", "object"]).default("string") }).strict(),
    generate: (ctx, o) => {
      const c = countryFor(ctx.rng, o.country);
      const street = `${ctx.rng.int(1, 9999)} ${ctx.rng.pick(STREET_NAMES)} ${ctx.rng.pick(STREET_SUFFIXES)}`;
      const city = ctx.rng.pick(c.cities);
      const postalCode = fromShape(ctx.rng, c.postal);
      if (o.format === "object") return { street, city, postalCode, country: c.name };
      return `${street}, ${city} ${postalCode}, ${c.name}`;
    },
  }),
  def({
    name: "dateOfBirth",
    category: "personal",
    description: "A date of birth (YYYY-MM-DD) for an age between minAge and maxAge at the reference date.",
    output: "date",
    options: z
      .object({ minAge: z.number().int().min(0).max(130).default(18), maxAge: z.number().int().min(0).max(130).default(75) })
      .strict()
      .refine((o) => o.maxAge >= o.minAge, { message: "maxAge must be >= minAge" }),
    generate: (ctx, o) => {
      const ref = ctx.referenceDate;
      const latest = new Date(Date.UTC(ref.getUTCFullYear() - o.minAge, ref.getUTCMonth(), ref.getUTCDate()));
      const earliest = new Date(Date.UTC(ref.getUTCFullYear() - o.maxAge - 1, ref.getUTCMonth(), ref.getUTCDate() + 1));
      return formatDate(randomDateBetween(ctx.rng, earliest, latest));
    },
  }),
  def({
    name: "username",
    category: "technical",
    description: "A username, derived from sibling name fields when present.",
    output: "string",
    options: none,
    generate: (ctx) => {
      const n = siblingName(ctx);
      const first = slugify(n.first ?? ctx.rng.pick(FIRST_NAMES)).replace(/\./g, "");
      const last = slugify(n.last ?? ctx.rng.pick(LAST_NAMES)).replace(/\./g, "");
      const style = ctx.rng.int(0, 2);
      const base = style === 0 ? `${first}${last}` : style === 1 ? `${first}_${last[0]}` : `${first[0]}${last}`;
      return `${base}${ctx.rng.int(1, 99)}`;
    },
  }),
];

// ---------------------------------------------------------------------------
// Professional
// ---------------------------------------------------------------------------

const professional: GeneratorDefinition<any>[] = [
  def({
    name: "company",
    category: "professional",
    description: "A fictional company name such as \"Cobalt Logistics Ltd.\".",
    output: "string",
    options: none,
    generate: (ctx) => `${ctx.rng.pick(COMPANY_PREFIXES)} ${ctx.rng.pick(COMPANY_CORES)} ${ctx.rng.pick(COMPANY_SUFFIXES)}`.trim(),
  }),
  def({
    name: "department",
    category: "professional",
    description: "A department name.",
    output: "string",
    options: z.object({ values: z.array(z.string()).min(1).optional() }).strict(),
    generate: (ctx, o) => ctx.rng.pick(o.values ?? Object.keys(DEPARTMENTS)),
  }),
  def({
    name: "jobTitle",
    category: "professional",
    description: "A job title. Consistent with a sibling department field when present.",
    output: "string",
    options: none,
    generate: (ctx) => {
      const dept = siblingString(ctx, ["department", "dept", "departmentname", "team"]);
      const titles = (dept && DEPARTMENTS[dept]) || DEPARTMENTS[ctx.rng.pick(Object.keys(DEPARTMENTS))] || ["Specialist"];
      return ctx.rng.pick(titles);
    },
  }),
  def({
    name: "designation",
    category: "professional",
    description: "A seniority designation (Associate ... Vice President), skewed toward junior levels.",
    output: "string",
    options: none,
    generate: (ctx) => ctx.rng.weighted(DESIGNATIONS, [30, 22, 16, 12, 9, 6, 4, 1]),
  }),
  def({
    name: "employeeId",
    category: "professional",
    description: "A sequential employee identifier such as EMP-0001. Unique within a collection.",
    output: "string",
    options: z
      .object({ prefix: z.string().max(20).default("EMP-"), pad: z.number().int().min(1).max(12).default(4), start: z.number().int().min(0).default(1) })
      .strict(),
    generate: (ctx, o) => `${o.prefix}${pad(o.start + ctx.index, o.pad)}`,
  }),
  def({
    name: "employmentStatus",
    category: "professional",
    description: "Employment status with a realistic distribution (mostly active).",
    output: "string",
    options: none,
    generate: (ctx) => ctx.rng.weighted(EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_WEIGHTS),
  }),
  def({
    name: "managerId",
    category: "professional",
    description:
      "A manager identifier placeholder. Configure a self-referencing relationship to make it point at real generated employees.",
    output: "string",
    options: z.object({ prefix: z.string().max(20).default("EMP-"), pad: z.number().int().min(1).max(12).default(4), max: z.number().int().min(1).default(50) }).strict(),
    generate: (ctx, o) => `${o.prefix}${pad(ctx.rng.int(1, o.max), o.pad)}`,
  }),
  def({
    name: "joiningDate",
    category: "professional",
    description: "A joining date (YYYY-MM-DD) within the last `maxYears` years of the reference date.",
    output: "date",
    options: z.object({ maxYears: z.number().min(0).max(60).default(15) }).strict(),
    generate: (ctx, o) => {
      const to = ctx.referenceDate;
      const from = new Date(to.getTime() - o.maxYears * 365.25 * 86_400_000);
      return formatDate(randomDateBetween(ctx.rng, from, to));
    },
  }),
  def({
    name: "salary",
    category: "professional",
    description: "An annual salary amount, normally distributed between min and max and rounded.",
    output: "number",
    options: z
      .object({
        min: z.number().min(0).default(30000),
        max: z.number().min(0).default(180000),
        roundTo: z.number().positive().default(500),
        distribution: distribution.default("normal"),
        mean: z.number().optional(),
        stddev: z.number().positive().optional(),
      })
      .strict()
      .refine((o) => o.max >= o.min, { message: "max must be >= min" }),
    generate: (ctx, o) => {
      const v = sampleNumber(ctx.rng, o);
      return Math.min(o.max, Math.max(o.min, Math.round(v / o.roundTo) * o.roundTo));
    },
  }),
  def({
    name: "salaryStructure",
    category: "professional",
    description: "A salary breakdown object: base, bonus, allowances, total and currency.",
    output: "object",
    options: z
      .object({ min: z.number().min(0).default(30000), max: z.number().min(0).default(180000), currency: z.string().length(3).optional() })
      .strict()
      .refine((o) => o.max >= o.min, { message: "max must be >= min" }),
    generate: (ctx, o) => {
      const base = Math.round(sampleNumber(ctx.rng, { min: o.min, max: o.max, distribution: "normal" }) / 100) * 100;
      const bonus = Math.round((base * ctx.rng.float(0, 0.2)) / 100) * 100;
      const allowances = Math.round((base * ctx.rng.float(0.02, 0.1)) / 100) * 100;
      return { base, bonus, allowances, total: base + bonus + allowances, currency: o.currency ?? ctx.rng.pick(CURRENCIES) };
    },
  }),
  def({
    name: "currency",
    category: "professional",
    description: "An ISO 4217 currency code.",
    output: "string",
    options: none,
    generate: (ctx) => ctx.rng.pick(CURRENCIES),
  }),
  def({
    name: "status",
    category: "professional",
    description: "A generic lifecycle status (active, inactive, pending ...).",
    output: "string",
    options: z.object({ values: z.array(z.string()).min(1).optional() }).strict(),
    generate: (ctx, o) => ctx.rng.pick(o.values ?? GENERIC_STATUSES),
  }),
];

// ---------------------------------------------------------------------------
// Technical
// ---------------------------------------------------------------------------

function prefixedId(name: string, description: string, defaultPrefix: string, length: number): GeneratorDefinition<any> {
  return def({
    name,
    category: "technical",
    description,
    output: "string",
    options: z.object({ prefix: z.string().max(20).default(defaultPrefix), length: z.number().int().min(4).max(64).default(length) }).strict(),
    generate: (ctx, o) => `${o.prefix}${ctx.rng.string(o.length, ALNUM)}`,
  });
}

const technical: GeneratorDefinition<any>[] = [
  def({
    name: "uuid",
    category: "technical",
    description: "A random-format (version 4 layout) UUID derived from the seeded RNG.",
    output: "string",
    options: none,
    generate: (ctx) => uuidFromRng(ctx.rng),
  }),
  def({
    name: "objectId",
    category: "technical",
    description: "A MongoDB-style 24-hex ObjectId. With extendedJson: true, emits {\"$oid\": \"...\"}.",
    output: "any",
    options: z.object({ extendedJson: z.boolean().default(false) }).strict(),
    generate: (ctx, o) => {
      const ts = Math.floor(ctx.referenceDate.getTime() / 1000) - ctx.rng.int(0, 86400 * 365 * 3);
      const id = ts.toString(16).padStart(8, "0").slice(-8) + ctx.rng.hex(16);
      return o.extendedJson ? { $oid: id } : id;
    },
  }),
  def({
    name: "apiId",
    category: "technical",
    description: "An opaque API resource identifier like \"res_8fK2...\" (base62).",
    output: "string",
    options: z.object({ prefix: z.string().max(20).default("res_"), length: z.number().int().min(4).max(64).default(16) }).strict(),
    generate: (ctx, o) => `${o.prefix}${ctx.rng.string(o.length, BASE62)}`,
  }),
  prefixedId("productId", "A product identifier like PRD-7K3M9Q.", "PRD-", 6),
  prefixedId("orderId", "An order identifier like ORD-4HXT8M2P.", "ORD-", 8),
  prefixedId("transactionRef", "A transaction reference like TXN-9Q4L... (not a payment credential).", "TXN-", 12),
  def({
    name: "url",
    category: "technical",
    description: "A URL on a reserved example domain (RFC 2606).",
    output: "string",
    options: none,
    generate: (ctx) => `https://${ctx.rng.pick(["www.", "app.", "api.", ""])}${ctx.rng.pick(SAFE_URL_DOMAINS)}/${ctx.rng.pick(URL_PATHS)}/${ctx.rng.string(8, "abcdefghijkmnopqrstuvwxyz23456789")}`,
  }),
  def({
    name: "ipv4",
    category: "technical",
    description: "An IPv4 address from the RFC 5737 documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).",
    output: "string",
    options: none,
    generate: (ctx) => `${ctx.rng.pick(["192.0.2", "198.51.100", "203.0.113"])}.${ctx.rng.int(1, 254)}`,
  }),
  def({
    name: "ipv6",
    category: "technical",
    description: "An IPv6 address from the RFC 3849 documentation prefix 2001:db8::/32.",
    output: "string",
    options: none,
    generate: (ctx) => `2001:db8:${Array.from({ length: 6 }, () => ctx.rng.hex(4).replace(/^0+(?=.)/, "")).join(":")}`,
  }),
  def({
    name: "governmentId",
    category: "technical",
    description:
      "A clearly invalid government-identifier-shaped value (area 000, which is never issued). Never a real identifier.",
    output: "string",
    options: none,
    generate: (ctx) => `000-${pad(ctx.rng.int(1, 99), 2)}-${pad(ctx.rng.int(1, 9999), 4)}`,
  }),
  def({
    name: "cardNumber",
    category: "technical",
    description:
      "A 16-digit card-shaped value starting with 0000 and a deliberately failing Luhn check digit. Not usable for payments.",
    output: "string",
    options: z.object({ separator: z.enum([" ", "-", ""]).default(" ") }).strict(),
    generate: (ctx, o) => {
      const digits = `0000${Array.from({ length: 11 }, () => ctx.rng.int(0, 9)).join("")}`;
      const check = (luhnCheckDigit(digits) + 1 + ctx.rng.int(0, 8)) % 10; // never the valid digit
      const full = digits + check;
      return full.match(/.{4}/g)!.join(o.separator);
    },
  }),
  def({
    name: "secret",
    category: "technical",
    description: "A placeholder for passwords, tokens and API keys. Clearly synthetic: dg_test_<hex>. Never a real credential.",
    output: "string",
    options: z.object({ prefix: z.string().max(20).default("dg_test_"), length: z.number().int().min(8).max(64).default(24) }).strict(),
    generate: (ctx, o) => `${o.prefix}${ctx.rng.hex(o.length)}`,
  }),
];

export function luhnCheckDigit(partial: string): number {
  let sum = 0;
  let double = true;
  for (let i = partial.length - 1; i >= 0; i--) {
    let d = partial.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export function luhnValid(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  return luhnCheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

// ---------------------------------------------------------------------------
// Numeric
// ---------------------------------------------------------------------------

const numericShape = {
  min: z.number().default(0),
  max: z.number().default(1000),
  distribution: distribution.default("uniform"),
  mean: z.number().optional(),
  stddev: z.number().positive().optional(),
  lambda: z.number().positive().optional(),
};
const boundsOk = (o: { min: number; max: number }) => o.max >= o.min;

const numeric: GeneratorDefinition<any>[] = [
  def({
    name: "integer",
    category: "numeric",
    description: "An integer in [min, max] with a uniform, normal or exponential distribution.",
    output: "integer",
    options: z.object(numericShape).strict().refine(boundsOk, { message: "max must be >= min" }),
    generate: (ctx, o) => {
      if (o.distribution === "uniform") return ctx.rng.int(o.min, o.max);
      const lo = Math.ceil(o.min);
      const hi = Math.floor(o.max);
      return Math.min(hi, Math.max(lo, Math.round(sampleNumber(ctx.rng, o))));
    },
  }),
  def({
    name: "decimal",
    category: "numeric",
    description: "A decimal in [min, max] rounded to `precision` places.",
    output: "number",
    options: z
      .object({ ...numericShape, precision: z.number().int().min(0).max(10).default(2) })
      .strict()
      .refine(boundsOk, { message: "max must be >= min" }),
    generate: (ctx, o) => Math.min(o.max, Math.max(o.min, roundTo(sampleNumber(ctx.rng, o), o.precision))),
  }),
  def({
    name: "number",
    category: "numeric",
    description:
      "A number in [min, max]. Integer output when both bounds are integers and no precision is set; otherwise decimal.",
    output: "number",
    options: z
      .object({ ...numericShape, max: z.number().default(100), precision: z.number().int().min(0).max(10).optional() })
      .strict()
      .refine(boundsOk, { message: "max must be >= min" }),
    generate: (ctx, o) => {
      const precision = o.precision ?? (Number.isInteger(o.min) && Number.isInteger(o.max) ? 0 : 2);
      if (precision === 0 && o.distribution === "uniform") return ctx.rng.int(o.min, o.max);
      return Math.min(o.max, Math.max(o.min, roundTo(sampleNumber(ctx.rng, o), precision)));
    },
  }),
  def({
    name: "percentage",
    category: "numeric",
    description: "A percentage between min and max (default 0-100).",
    output: "number",
    options: z
      .object({ ...numericShape, max: z.number().default(100), precision: z.number().int().min(0).max(6).default(1) })
      .strict()
      .refine(boundsOk, { message: "max must be >= min" }),
    generate: (ctx, o) => roundTo(sampleNumber(ctx.rng, o), o.precision),
  }),
  def({
    name: "currencyAmount",
    category: "numeric",
    description: "A monetary amount with 2 decimals. With currency set, returns {amount, currency}.",
    output: "any",
    options: z
      .object({ ...numericShape, currency: z.string().length(3).optional() })
      .strict()
      .refine(boundsOk, { message: "max must be >= min" }),
    generate: (ctx, o) => {
      const amount = roundTo(sampleNumber(ctx.rng, o), 2);
      return o.currency ? { amount, currency: o.currency } : amount;
    },
  }),
];

// ---------------------------------------------------------------------------
// Temporal
// ---------------------------------------------------------------------------

const rangeShape = { from: dateInput.default("-5y"), to: dateInput.default("now") };

function rangeOf(ctx: GeneratorContext, o: { from: string | number; to: string | number }): [Date, Date] {
  return [resolveDate(o.from, ctx.referenceDate, ctx.referenceDate), resolveDate(o.to, ctx.referenceDate, ctx.referenceDate)];
}

const temporal: GeneratorDefinition<any>[] = [
  def({
    name: "date",
    category: "temporal",
    description: "A calendar date (YYYY-MM-DD) between from and to. Accepts ISO dates or offsets like \"-5y\", \"+30d\".",
    output: "date",
    options: z.object(rangeShape).strict(),
    generate: (ctx, o) => formatDate(randomDateBetween(ctx.rng, ...rangeOf(ctx, o))),
  }),
  def({
    name: "timestamp",
    category: "temporal",
    description: "A timestamp between from and to, as ISO 8601 (default), epoch milliseconds or epoch seconds.",
    output: "timestamp",
    options: z.object({ ...rangeShape, format: z.enum(["iso", "epoch-ms", "epoch-s"]).default("iso") }).strict(),
    generate: (ctx, o) => {
      const d = randomDateBetween(ctx.rng, ...rangeOf(ctx, o));
      d.setUTCMilliseconds(0);
      if (o.format === "epoch-ms") return d.getTime();
      if (o.format === "epoch-s") return Math.floor(d.getTime() / 1000);
      return d.toISOString();
    },
  }),
  def({
    name: "pastDate",
    category: "temporal",
    description: "A date within the last `years` years before the reference date.",
    output: "date",
    options: z.object({ years: z.number().positive().max(200).default(5) }).strict(),
    generate: (ctx, o) => formatDate(randomDateBetween(ctx.rng, addDays(ctx.referenceDate, -365.25 * o.years), addDays(ctx.referenceDate, -1))),
  }),
  def({
    name: "futureDate",
    category: "temporal",
    description: "A date within the next `years` years after the reference date.",
    output: "date",
    options: z.object({ years: z.number().positive().max(200).default(2) }).strict(),
    generate: (ctx, o) => formatDate(randomDateBetween(ctx.rng, addDays(ctx.referenceDate, 1), addDays(ctx.referenceDate, 365.25 * o.years))),
  }),
  def({
    name: "dateRange",
    category: "temporal",
    description: "An object {start, end} where end follows start by minDays..maxDays.",
    output: "object",
    options: z
      .object({ ...rangeShape, minDays: z.number().int().min(0).default(1), maxDays: z.number().int().min(0).default(365) })
      .strict()
      .refine((o) => o.maxDays >= o.minDays, { message: "maxDays must be >= minDays" }),
    generate: (ctx, o) => {
      const start = randomDateBetween(ctx.rng, ...rangeOf(ctx, o));
      const end = addDays(start, ctx.rng.int(o.minDays, o.maxDays));
      return { start: formatDate(start), end: formatDate(end) };
    },
  }),
  def({
    name: "renewalDate",
    category: "temporal",
    description: "A renewal date: an anniversary of a sibling start/joining date after the reference date, or within the next year.",
    output: "date",
    options: z.object({ termMonths: z.number().int().min(1).max(120).default(12) }).strict(),
    generate: (ctx, o) => {
      const start = siblingString(ctx, ["startdate", "joiningdate", "joindate", "createdat", "signedat", "startedat", "datejoined"]);
      const base = start ? new Date(start) : null;
      if (base && !Number.isNaN(base.getTime())) {
        const d = new Date(base.getTime());
        while (d <= ctx.referenceDate) d.setUTCMonth(d.getUTCMonth() + o.termMonths);
        return formatDate(d);
      }
      return formatDate(randomDateBetween(ctx.rng, addDays(ctx.referenceDate, 1), addDays(ctx.referenceDate, 30 * o.termMonths)));
    },
  }),
  def({
    name: "expiryDate",
    category: "temporal",
    description: "An expiry date; `expiredRatio` controls the share already expired relative to the reference date.",
    output: "date",
    options: z
      .object({ expiredRatio: z.number().min(0).max(1).default(0.1), maxYears: z.number().positive().max(50).default(3) })
      .strict(),
    generate: (ctx, o) => {
      const ref = ctx.referenceDate;
      if (ctx.rng.bool(o.expiredRatio)) return formatDate(randomDateBetween(ctx.rng, addDays(ref, -365), addDays(ref, -1)));
      return formatDate(randomDateBetween(ctx.rng, addDays(ref, 1), addDays(ref, 365.25 * o.maxYears)));
    },
  }),
];

// ---------------------------------------------------------------------------
// Custom / structural
// ---------------------------------------------------------------------------

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const custom: GeneratorDefinition<any>[] = [
  def({
    name: "constant",
    category: "custom",
    description: "Always returns the configured value.",
    output: "any",
    options: z.object({ value: z.unknown() }).strict(),
    generate: (_ctx, o) => (o.value !== null && typeof o.value === "object" ? structuredClone(o.value) : o.value),
  }),
  def({
    name: "enum",
    category: "custom",
    description: "One of `values`, optionally weighted.",
    output: "any",
    options: z
      .object({ values: z.array(scalar).min(1), weights: z.array(z.number().min(0)).optional() })
      .strict()
      .refine((o) => !o.weights || o.weights.length === o.values.length, { message: "weights must have one entry per value" }),
    generate: (ctx, o) => (o.weights ? ctx.rng.weighted(o.values, o.weights) : ctx.rng.pick(o.values)),
  }),
  def({
    name: "boolean",
    category: "custom",
    description: "true with the given probability (default 0.5).",
    output: "boolean",
    options: z.object({ probability: z.number().min(0).max(1).default(0.5) }).strict(),
    generate: (ctx, o) => ctx.rng.bool(o.probability),
  }),
  def({
    name: "sequence",
    category: "custom",
    description: "A sequential value: prefix + zero-padded (start + index * step). Unique within a collection.",
    output: "any",
    options: z
      .object({
        prefix: z.string().max(40).default(""),
        suffix: z.string().max(40).default(""),
        start: z.number().int().default(1),
        step: z.number().int().min(1).default(1),
        pad: z.number().int().min(0).max(20).default(0),
      })
      .strict(),
    generate: (ctx, o) => {
      const n = o.start + ctx.index * o.step;
      if (!o.prefix && !o.suffix && o.pad === 0) return n;
      return `${o.prefix}${pad(n, o.pad)}${o.suffix}`;
    },
  }),
  def({
    name: "pattern",
    category: "custom",
    description: "A string matching a safe subset of regular-expression syntax (no backreferences or lookarounds).",
    output: "string",
    options: z
      .object({ pattern: z.string().min(1).max(500) })
      .strict()
      .superRefine((o, issue) => {
        try {
          compilePattern(o.pattern);
        } catch (e) {
          issue.addIssue({ code: "custom", message: (e as Error).message });
        }
      }),
    generate: (ctx, o) => getPattern(o.pattern).generate(ctx.rng),
  }),
  def({
    name: "string",
    category: "text",
    description: "Neutral placeholder words with a length between minLength and maxLength.",
    output: "string",
    options: z
      .object({ minLength: z.number().int().min(0).max(10000).default(5), maxLength: z.number().int().min(0).max(10000).default(24) })
      .strict()
      .refine((o) => o.maxLength >= o.minLength, { message: "maxLength must be >= minLength" }),
    generate: (ctx, o) => {
      const target = ctx.rng.int(o.minLength, o.maxLength);
      if (target === 0) return "";
      // Whole words where they fit; cut the last word only when needed to reach minLength.
      let s = "";
      for (let i = 0; i < 64 && s.length < target; i++) {
        const w = ctx.rng.pick(WORDS);
        const next = s ? `${s} ${w}` : w;
        if (next.length > target) {
          if (s.length < o.minLength || !s) s = next.slice(0, target);
          break;
        }
        s = next;
      }
      return s.length < o.minLength ? s.padEnd(o.minLength, "x") : s;
    },
  }),
  def({
    name: "sentence",
    category: "text",
    description: "A sentence of neutral placeholder words.",
    output: "string",
    options: z.object({ minWords: z.number().int().min(1).max(200).default(4), maxWords: z.number().int().min(1).max(200).default(12) }).strict(),
    generate: (ctx, o) => {
      const n = ctx.rng.int(o.minWords, Math.max(o.minWords, o.maxWords));
      const words = Array.from({ length: n }, () => ctx.rng.pick(WORDS));
      const s = words.join(" ");
      return s.charAt(0).toUpperCase() + s.slice(1) + ".";
    },
  }),
  def({
    name: "null",
    category: "custom",
    description: "Always null.",
    output: "any",
    options: none,
    generate: () => null,
  }),
];

export const BUILTIN_GENERATORS: readonly GeneratorDefinition<any>[] = [
  ...personal,
  ...professional,
  ...technical,
  ...numeric,
  ...temporal,
  ...custom,
];

/** Shorthand names accepted in schemas, mapped to canonical generator names. */
export const GENERATOR_ALIASES: Readonly<Record<string, string>> = {
  name: "fullName",
  firstname: "firstName",
  lastname: "lastName",
  phoneNumber: "phone",
  zip: "postalCode",
  zipCode: "postalCode",
  postcode: "postalCode",
  int: "integer",
  float: "decimal",
  double: "decimal",
  bool: "boolean",
  datetime: "timestamp",
  id: "uuid",
  guid: "uuid",
  ip: "ipv4",
  ipAddress: "ipv4",
  money: "currencyAmount",
  amount: "currencyAmount",
  text: "sentence",
  regex: "pattern",
  password: "secret",
  token: "secret",
  apiKey: "secret",
  title: "jobTitle",
  dob: "dateOfBirth",
  birthDate: "dateOfBirth",
  companyName: "company",
  oid: "objectId",
};
