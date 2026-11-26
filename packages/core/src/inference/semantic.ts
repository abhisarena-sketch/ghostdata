import type { PrivacyClassification } from "@workfonic/dataghost-privacy";
import type { FieldAccumulator, StringFormat } from "./stats.js";

export interface GeneratorSuggestion {
  type: string;
  options: Record<string, unknown>;
}

export interface SemanticGuess {
  semanticType: string;
  generator: GeneratorSuggestion;
  confidence: number;
  reason: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function singular(s: string): string {
  const n = norm(s);
  if (n.endsWith("ies")) return n.slice(0, -3) + "y";
  if (n.endsWith("s") && !n.endsWith("ss")) return n.slice(0, -1);
  return n;
}

function formatRate(acc: FieldAccumulator, f: StringFormat): number {
  const s = acc.str;
  if (!s || !s.count) return 0;
  return (s.formats[f] ?? 0) / s.count;
}

function nonNull(acc: FieldAccumulator): number {
  return acc.present - acc.nulls;
}

function dominant(acc: FieldAccumulator): "string" | "integer" | "number" | "boolean" | "object" | "array" | "extended" | "null" {
  let best: keyof FieldAccumulator["types"] | "null" = "null";
  let n = 0;
  for (const [k, v] of Object.entries(acc.types) as [keyof FieldAccumulator["types"], number][]) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  if (best === "integer" && acc.types.number > 0) return "number";
  return best;
}

function mean(acc: FieldAccumulator): number {
  return acc.num ? acc.num.sum / acc.num.count : 0;
}

function stddev(acc: FieldAccumulator): number {
  if (!acc.num || acc.num.count < 2) return 0;
  const m = mean(acc);
  return Math.sqrt(Math.max(0, acc.num.sumSq / acc.num.count - m * m));
}

/** Numeric generator options learned from observed values. */
export function numericSuggestion(acc: FieldAccumulator, generator?: string): GeneratorSuggestion {
  const n = acc.num!;
  const isInt = n.integers === n.count;
  const opts: Record<string, unknown> = { min: n.min, max: n.max };
  const sd = stddev(acc);
  if (n.count >= 30 && sd > 0 && n.max > n.min) {
    opts.distribution = "normal";
    opts.mean = Math.round(mean(acc) * 1000) / 1000;
    opts.stddev = Math.round(sd * 1000) / 1000;
  }
  if (generator) return { type: generator, options: generator === "percentage" ? { ...opts, precision: Math.min(6, n.maxDecimals) } : opts };
  if (isInt) return { type: "integer", options: opts };
  return { type: "decimal", options: { ...opts, precision: Math.max(1, Math.min(10, n.maxDecimals)) } };
}

function dateRange(acc: FieldAccumulator, kind: "date" | "timestamp"): GeneratorSuggestion {
  let min = "";
  let max = "";
  for (const v of acc.samples) {
    if (typeof v !== "string") continue;
    if (!min || v < min) min = v;
    if (!max || v > max) max = v;
  }
  const opts: Record<string, unknown> = {};
  if (min && max && !Number.isNaN(Date.parse(min)) && !Number.isNaN(Date.parse(max))) {
    opts.from = kind === "date" ? min.slice(0, 10) : new Date(min).toISOString();
    opts.to = kind === "date" ? max.slice(0, 10) : new Date(max).toISOString();
  }
  return { type: kind, options: opts };
}

/** Learn an identifier format such as "EMP-0042" => prefix "EMP-", pad 4. */
function idFormat(acc: FieldAccumulator): { prefix: string; pad: number } | undefined {
  const s = acc.str;
  if (!s || !s.count || (s.formats.idPattern ?? 0) / s.count < 0.95) return undefined;
  if (s.idPrefix === undefined || s.idPrefix === null) return undefined;
  return { prefix: s.idPrefix, pad: s.idDigits ?? 3 };
}

function isUnique(acc: FieldAccumulator): boolean {
  return !acc.distinctOverflow && acc.distinct.size === nonNull(acc) && nonNull(acc) > 1;
}

function enumSuggestion(acc: FieldAccumulator): GeneratorSuggestion | undefined {
  const count = nonNull(acc);
  if (acc.distinctOverflow || count < 4) return undefined;
  const size = acc.distinct.size;
  if (size === 0 || size > 20 || size > count * 0.5) return undefined;
  const values: (string | number | boolean)[] = [];
  const weights: number[] = [];
  for (const [k, n] of acc.distinct) {
    const raw = k.slice(2);
    values.push(k.startsWith("n:") ? Number(raw) : k.startsWith("b:") ? raw === "true" : raw);
    weights.push(n);
  }
  return { type: "enum", options: { values, weights } };
}

interface Rule {
  test: RegExp;
  semantic: string;
  generator: string | ((acc: FieldAccumulator) => GeneratorSuggestion | undefined);
  score: number;
  /** Required dominant value type. */
  needs?: "string" | "number" | "object";
}

const RULES: Rule[] = [
  { test: /^(firstname|givenname|fname|forename)$/, semantic: "firstName", generator: "firstName", score: 0.9, needs: "string" },
  { test: /^(lastname|surname|familyname|lname)$/, semantic: "lastName", generator: "lastName", score: 0.9, needs: "string" },
  { test: /^(fullname|name|employeename|customername|contactname|displayname|personname|patientname|studentname|ownername|holdername)$/, semantic: "fullName", generator: "fullName", score: 0.8, needs: "string" },
  { test: /email|mail$/, semantic: "email", generator: () => ({ type: "email", options: {} }), score: 0.85, needs: "string" },
  { test: /^(phone|phonenumber|mobile|mobilenumber|tel|telephone|cell|cellphone|contactnumber|fax)$|phone$/, semantic: "phone", generator: "phone", score: 0.85, needs: "string" },
  { test: /^(street|streetaddress|addressline\d?|line\d|street\d)$/, semantic: "street", generator: "street", score: 0.85, needs: "string" },
  { test: /address$/, semantic: "address", generator: (acc) => (dominant(acc) === "object" ? undefined : { type: "address", options: {} }), score: 0.8 },
  { test: /^(city|town|cityname)$/, semantic: "city", generator: "city", score: 0.85, needs: "string" },
  { test: /^(country|countryname|nationality)$/, semantic: "country", generator: (acc) => ({ type: (acc.str?.maxLength ?? 3) <= 2 ? "countryCode" : "country", options: {} }), score: 0.85, needs: "string" },
  { test: /^(countrycode|countryiso|iso2)$/, semantic: "countryCode", generator: "countryCode", score: 0.85, needs: "string" },
  { test: /^(zip|zipcode|postcode|postalcode|pincode|postal)$/, semantic: "postalCode", generator: (acc) => ({ type: "postalCode", options: commonShape(acc) ? { shape: commonShape(acc) } : {} }), score: 0.85 },
  { test: /^(company|companyname|employer|organisation|organization|orgname|business|businessname)$/, semantic: "company", generator: "company", score: 0.85, needs: "string" },
  { test: /^(jobtitle|title|position|role|jobrole|occupation)$/, semantic: "jobTitle", generator: "jobTitle", score: 0.7, needs: "string" },
  { test: /^(department|dept|departmentname|deptname|team|division)$/, semantic: "department", generator: "department", score: 0.8, needs: "string" },
  { test: /^(designation|grade|seniority|level|band)$/, semantic: "designation", generator: "designation", score: 0.6, needs: "string" },
  { test: /^(salary|ctc|basesalary|annualsalary|compensation|pay|wage|grosspay)$/, semantic: "salary", generator: (acc) => (dominant(acc) === "object" ? undefined : acc.num ? { type: "salary", options: { min: acc.num.min, max: acc.num.max, roundTo: acc.num.integers === acc.num.count && acc.num.min % 100 === 0 ? 100 : 1 } } : undefined), score: 0.85 },
  { test: /^(currency|currencycode|ccy)$/, semantic: "currency", generator: "currency", score: 0.85, needs: "string" },
  { test: /^(dob|dateofbirth|birthdate|birthday)$/, semantic: "dateOfBirth", generator: "dateOfBirth", score: 0.9, needs: "string" },
  { test: /^(employeeid|empid|staffid|employeenumber|empno|employeecode|empcode)$/, semantic: "employeeId", generator: (acc) => { const f = idFormat(acc); return f ? { type: "employeeId", options: { prefix: f.prefix, pad: f.pad } } : undefined; }, score: 0.85 },
  { test: /^(managerid|reportsto|supervisorid|reportingmanagerid|reportingmanager|managerempid|leadid)$/, semantic: "managerId", generator: (acc) => { const f = idFormat(acc); return f ? { type: "managerId", options: { prefix: f.prefix, pad: f.pad, max: Math.max(1, acc.str?.idMaxNumber ?? 50) } } : undefined; }, score: 0.75 },
  { test: /^(joiningdate|hiredate|dateofjoining|joindate|datejoined|startdate|employmentdate|doj)$/, semantic: "joiningDate", generator: (acc) => dateRange(acc, "date"), score: 0.75, needs: "string" },
  { test: /^(renewaldate|renewson|nextrenewal|renewalon)$/, semantic: "renewalDate", generator: "renewalDate", score: 0.8, needs: "string" },
  { test: /^(expirydate|expirationdate|expiresat|expireson|validuntil|validtill|expiry)$/, semantic: "expiryDate", generator: (acc) => (formatRate(acc, "timestamp") > 0.9 ? dateRange(acc, "timestamp") : { type: "expiryDate", options: {} }), score: 0.75, needs: "string" },
  { test: /^(employmentstatus|empstatus|workstatus)$/, semantic: "employmentStatus", generator: (acc) => enumSuggestion(acc) ?? { type: "employmentStatus", options: {} }, score: 0.8, needs: "string" },
  { test: /status$|^state$/, semantic: "status", generator: (acc) => enumSuggestion(acc) ?? { type: "status", options: {} }, score: 0.7, needs: "string" },
  { test: /^(username|login|handle|userhandle|screenname|nickname)$/, semantic: "username", generator: "username", score: 0.8, needs: "string" },
  { test: /^(url|website|homepage|link|href|uri|imageurl|avatarurl|profileurl|webpage)$|url$/, semantic: "url", generator: "url", score: 0.8, needs: "string" },
  { test: /^(ip|ipaddress|ipaddr|clientip|remoteaddr|sourceip|lastloginip)$/, semantic: "ipAddress", generator: (acc) => ({ type: formatRate(acc, "ipv6") > 0.5 ? "ipv6" : "ipv4", options: {} }), score: 0.85, needs: "string" },
  { test: /^(productid|sku|productcode|itemid|itemcode)$/, semantic: "productId", generator: (acc) => idOrPattern(acc, "productId"), score: 0.75, needs: "string" },
  { test: /^(orderid|ordernumber|orderno|orderref)$/, semantic: "orderId", generator: (acc) => idOrPattern(acc, "orderId"), score: 0.75, needs: "string" },
  { test: /^(transactionid|transactionref|txnid|txnref|paymentref|referencenumber|reference)$/, semantic: "transactionRef", generator: (acc) => idOrPattern(acc, "transactionRef"), score: 0.75, needs: "string" },
  { test: /^(password|passwd|pwd|passwordhash|hashedpassword|passcode|pin)$/, semantic: "password", generator: "secret", score: 0.95 },
  { test: /token$|^(apikey|secret|secretkey|clientsecret|accesskey|privatekey|sessionid|jwt)$/, semantic: "secret", generator: "secret", score: 0.9, needs: "string" },
  { test: /^(ssn|nationalid|taxid|tin|passport|passportnumber|aadhaar|pan|nin|governmentid)$/, semantic: "governmentId", generator: "governmentId", score: 0.9 },
  { test: /^(cardnumber|creditcard|creditcardnumber|ccnumber|cc|cardno)$/, semantic: "cardNumber", generator: "cardNumber", score: 0.9 },
  { test: /^(percentage|percent|pct|ratio|rate|discount|completion|progress|utilization|utilisation)$|percent(age)?$/, semantic: "percentage", generator: (acc) => (acc.num ? numericSuggestion(acc, "percentage") : undefined), score: 0.7, needs: "number" },
  { test: /^(price|amount|total|cost|subtotal|balance|fee|revenue|unitprice|totalamount)$|(price|amount|cost)$/, semantic: "currencyAmount", generator: (acc) => (acc.num ? { type: "currencyAmount", options: { min: acc.num.min, max: acc.num.max } } : undefined), score: 0.7, needs: "number" },
  { test: /^(age)$/, semantic: "age", generator: (acc) => (acc.num ? numericSuggestion(acc) : undefined), score: 0.7, needs: "number" },
  { test: /^(createdat|updatedat|deletedat|timestamp|modifiedat|lastlogin|lastloginat|loggedat|occurredat|eventtime|datetime)$|at$/, semantic: "timestamp", generator: (acc) => (formatRate(acc, "timestamp") > 0.9 ? dateRange(acc, "timestamp") : formatRate(acc, "date") > 0.9 ? dateRange(acc, "date") : undefined), score: 0.7, needs: "string" },
  { test: /^(description|notes|note|comment|comments|bio|summary|about|remarks|message)$/, semantic: "text", generator: "sentence", score: 0.6, needs: "string" },
];

/** The shared character shape of string samples ("99999", "AA9 9AA"), if they all match. */
function commonShape(acc: FieldAccumulator): string | undefined {
  let shape: string | undefined;
  for (const v of acc.samples) {
    if (typeof v !== "string" || v.length > 20) return undefined;
    const s = v.replace(/[0-9]/g, "9").replace(/[A-Z]/g, "A").replace(/[a-z]/g, "a");
    if (shape === undefined) shape = s;
    else if (shape !== s) return undefined;
  }
  return shape;
}

function idOrPattern(acc: FieldAccumulator, fallback: string): GeneratorSuggestion {
  const f = idFormat(acc);
  if (f) return isUnique(acc) ? { type: "sequence", options: { prefix: f.prefix, pad: f.pad } } : { type: "pattern", options: { pattern: `${escapeRe(f.prefix)}\\d{${f.pad}}` } };
  return { type: fallback, options: {} };
}

function escapeRe(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|-]/g, (c) => `\\${c}`);
}

const PRIVACY_TO_GENERATOR: Record<string, string> = {
  email: "email",
  phone: "phone",
  governmentId: "governmentId",
  cardNumber: "cardNumber",
  password: "secret",
  authToken: "secret",
  apiKey: "secret",
  ipAddress: "ipv4",
  personName: "fullName",
  address: "address",
  dateOfBirth: "dateOfBirth",
};

/**
 * Guess the semantic type of a field from its name, its parent/collection
 * context and observed value formats. Returns undefined for plain fields.
 */
export function detectSemantic(leaf: string, parent: string, acc: FieldAccumulator, privacy?: PrivacyClassification): SemanticGuess | undefined {
  const name = norm(leaf);
  const parentName = singular(parent);
  const type = dominant(acc);
  const valueType = type === "integer" || type === "number" ? "number" : type;

  // Context: departments[].name -> department, companies[].name -> company.
  if (name === "name" || name === "title") {
    if (/^(department|dept|team|division)$/.test(parentName)) return { semanticType: "department", generator: { type: "department", options: {} }, confidence: 0.8, reason: `"${leaf}" of "${parent}"` };
    if (/^(company|organisation|organization|employer|vendor|supplier|customer?account|business)$/.test(parentName)) return { semanticType: "company", generator: { type: "company", options: {} }, confidence: 0.8, reason: `"${leaf}" of "${parent}"` };
    if (/^(product|item|project|plan|category|tag|role|skill|event|file|document|course)$/.test(parentName)) return undefined;
  }
  if (parentName === "address" || parentName.endsWith("address")) {
    if (/^(line\d?|street\d?)$/.test(name)) return { semanticType: "street", generator: { type: "street", options: {} }, confidence: 0.85, reason: `"${leaf}" inside "${parent}"` };
  }
  if (parentName === "name" && ["first", "given"].includes(name)) return { semanticType: "firstName", generator: { type: "firstName", options: {} }, confidence: 0.85, reason: `"${leaf}" inside "${parent}"` };
  if (parentName === "name" && ["last", "family"].includes(name)) return { semanticType: "lastName", generator: { type: "lastName", options: {} }, confidence: 0.85, reason: `"${leaf}" inside "${parent}"` };

  let best: SemanticGuess | undefined;
  for (const rule of RULES) {
    if (!rule.test.test(name)) continue;
    if (rule.needs && rule.needs !== valueType && !(rule.needs === "string" && type === "extended")) continue;
    const gen = typeof rule.generator === "string" ? { type: rule.generator, options: {} } : rule.generator(acc);
    if (!gen) continue;
    let confidence = rule.score;
    // Corroborate with value formats.
    const fmt: Partial<Record<string, StringFormat>> = { email: "email", url: "url", ipAddress: "ipv4", dateOfBirth: "date", joiningDate: "date", phone: "phone" };
    const f = fmt[rule.semantic];
    if (f) {
      const r = formatRate(acc, f);
      if (r > 0.9) confidence = Math.min(0.99, confidence + 0.1);
      else if (r < 0.5 && nonNull(acc) > 0) confidence -= 0.25;
    }
    if (privacy?.category && PRIVACY_TO_GENERATOR[privacy.category] === gen.type) confidence = Math.min(0.99, confidence + 0.05);
    best = { semanticType: rule.semantic, generator: gen, confidence: Math.round(confidence * 100) / 100, reason: `field name "${leaf}"` };
    break;
  }
  if (best && best.confidence >= 0.5) return best;

  // Value formats alone.
  if (type === "extended" && acc.extended?.$oid) return { semanticType: "objectId", generator: { type: "objectId", options: { extendedJson: true } }, confidence: 0.95, reason: 'MongoDB {"$oid"} values' };
  if (type === "string" || type === "extended") {
    const checks: [StringFormat, string, GeneratorSuggestion][] = [
      ["email", "email", { type: "email", options: {} }],
      ["uuid", "uuid", { type: "uuid", options: {} }],
      ["objectId", "objectId", { type: "objectId", options: {} }],
      ["url", "url", { type: "url", options: {} }],
      ["ipv4", "ipAddress", { type: "ipv4", options: {} }],
      ["ipv6", "ipAddress", { type: "ipv6", options: {} }],
    ];
    for (const [fmt, semantic, gen] of checks) {
      const r = formatRate(acc, fmt);
      if (r >= 0.9) return { semanticType: semantic, generator: gen, confidence: Math.round(0.9 * r * 100) / 100, reason: `${Math.round(r * 100)}% of values look like ${fmt}` };
    }
    if (privacy?.category && privacy.confidence >= 0.6 && PRIVACY_TO_GENERATOR[privacy.category]) {
      const g = PRIVACY_TO_GENERATOR[privacy.category]!;
      return { semanticType: privacy.category, generator: { type: g, options: {} }, confidence: privacy.confidence, reason: "privacy detection" };
    }
    const id = idFormat(acc);
    if (id && /id$|code$|ref$|no$|number$|key$/.test(name)) {
      return { semanticType: "identifier", generator: idOrPattern(acc, "apiId"), confidence: 0.75, reason: `identifier format "${id.prefix}${"9".repeat(id.pad)}"` };
    }
  }
  return best;
}

export { dominant, enumSuggestion, isUnique, dateRange, formatRate, nonNull };
