import { luhnValid, vocab } from "@workfonic/dataghost-generators";

export type SensitiveCategory =
  | "email"
  | "phone"
  | "governmentId"
  | "cardNumber"
  | "password"
  | "authToken"
  | "apiKey"
  | "ipAddress"
  | "personName"
  | "address"
  | "dateOfBirth"
  | "identifier"
  | "quasiIdentifier"
  | "freeText";

export type SensitivityLevel = "none" | "low" | "medium" | "high" | "secret";

export interface Detection {
  category: SensitiveCategory;
  confidence: number;
  reasons: string[];
}

export interface PrivacyClassification {
  level: SensitivityLevel;
  /** Most likely category, if any. */
  category?: SensitiveCategory;
  confidence: number;
  /** All candidate categories, most likely first. */
  detections: Detection[];
  /** True when the classification should be reviewed by a person. */
  uncertain: boolean;
  warnings: string[];
}

export interface FieldEvidence {
  /** Full field path, e.g. "employees[].contact.email". */
  path: string;
  /** Sample values (only analysed locally, never stored in the result). */
  samples: readonly unknown[];
}

export const CATEGORY_LEVEL: Readonly<Record<SensitiveCategory, SensitivityLevel>> = {
  password: "secret",
  authToken: "secret",
  apiKey: "secret",
  governmentId: "high",
  cardNumber: "high",
  email: "medium",
  phone: "medium",
  personName: "medium",
  address: "medium",
  dateOfBirth: "medium",
  ipAddress: "medium",
  identifier: "low",
  quasiIdentifier: "low",
  freeText: "low",
};

const LEVEL_RANK: Record<SensitivityLevel, number> = { none: 0, low: 1, medium: 2, high: 3, secret: 4 };

/** Split "homeAddress_line1" into ["home", "address", "line", "1"]. */
export function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+|(?<=[a-zA-Z])(?=\d)/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

interface NameRule {
  category: SensitiveCategory;
  score: number;
  /** Matches when all tokens appear (in order not required). */
  all?: string[];
  /** Matches when the joined lowercase name equals one of these. */
  exact?: string[];
  /** Field name tokens that veto the rule. */
  unless?: string[];
}

const NOT_PERSON = ["company", "product", "file", "department", "dept", "project", "brand", "city", "country", "street", "host", "domain", "team", "org", "organization", "organisation", "app", "event", "category", "item", "plan", "role", "job", "tag", "bank", "store", "vendor", "server", "service", "path", "field", "class", "type", "table", "key", "group", "user"];

const NAME_RULES: NameRule[] = [
  { category: "email", score: 0.85, all: ["email"] },
  { category: "email", score: 0.8, all: ["mail"], unless: ["mailbox", "chain"] },
  { category: "phone", score: 0.85, all: ["phone"] },
  { category: "phone", score: 0.8, all: ["mobile"], unless: ["app", "os", "device"] },
  { category: "phone", score: 0.7, exact: ["tel", "telephone", "cell", "cellphone", "fax", "msisdn", "whatsapp"] },
  { category: "governmentId", score: 0.9, exact: ["ssn", "sin", "nin", "nino", "aadhaar", "aadhar", "pan", "panno", "passport", "passportnumber", "passportno", "nationalid", "taxid", "tin", "itin", "nric", "cpf", "dni", "nie", "steuerid", "socialsecuritynumber", "driverslicense", "driverlicense", "drivinglicence", "licensenumber", "voterid", "governmentid", "govid"] },
  { category: "governmentId", score: 0.75, all: ["social", "security"] },
  { category: "governmentId", score: 0.75, all: ["national", "id"] },
  { category: "governmentId", score: 0.7, all: ["passport"] },
  { category: "cardNumber", score: 0.9, exact: ["cardnumber", "creditcard", "creditcardnumber", "ccnumber", "cc", "ccnum", "cardno", "debitcard", "pan_number"] },
  { category: "cardNumber", score: 0.75, all: ["card", "number"] },
  { category: "cardNumber", score: 0.85, exact: ["cvv", "cvc", "cvv2", "securitycode"] },
  { category: "cardNumber", score: 0.6, exact: ["iban", "accountnumber", "bankaccount", "routingnumber", "sortcode"] },
  { category: "password", score: 0.95, exact: ["password", "passwd", "pwd", "pass", "passphrase", "passcode", "pin", "passwordhash", "hashedpassword", "pwhash", "userpassword"] },
  { category: "password", score: 0.85, all: ["password"] },
  { category: "authToken", score: 0.9, all: ["token"], unless: ["count", "limit", "type", "expiry", "expires", "ttl"] },
  { category: "authToken", score: 0.85, exact: ["jwt", "bearer", "sessionid", "session", "cookie", "authorization", "auth", "refresh", "otp", "mfasecret", "totpsecret"] },
  { category: "apiKey", score: 0.95, exact: ["apikey", "api_key", "accesskey", "secretkey", "privatekey", "clientsecret", "secret", "signingkey", "webhooksecret", "accesskeyid", "secretaccesskey", "encryptionkey"] },
  { category: "apiKey", score: 0.85, all: ["api", "key"] },
  { category: "apiKey", score: 0.85, all: ["secret"], unless: ["question", "santa"] },
  { category: "apiKey", score: 0.8, all: ["private", "key"] },
  { category: "ipAddress", score: 0.85, exact: ["ip", "ipaddress", "ipaddr", "ipv4", "ipv6", "remoteaddr", "remoteaddress", "clientip", "sourceip", "lastip", "lastloginip", "xforwardedfor"] },
  { category: "ipAddress", score: 0.7, all: ["ip"] },
  { category: "personName", score: 0.9, exact: ["firstname", "lastname", "surname", "fullname", "givenname", "familyname", "middlename", "maidenname", "forename", "fname", "lname", "nickname", "employeename", "customername", "contactname", "patientname", "username", "displayname", "personname", "studentname", "holdername", "cardholder", "cardholdername", "managername", "ownername", "spousename", "fathername", "mothername", "guardianname"] },
  { category: "personName", score: 0.65, exact: ["name"] },
  { category: "address", score: 0.85, exact: ["address", "streetaddress", "street", "addressline", "addressline1", "addressline2", "line1", "line2", "homeaddress", "mailingaddress", "billingaddress", "shippingaddress", "residentialaddress", "permanentaddress", "street1", "street2"] },
  { category: "address", score: 0.75, all: ["address"], unless: ["ip", "email", "mac", "wallet", "web"] },
  { category: "dateOfBirth", score: 0.95, exact: ["dob", "dateofbirth", "birthdate", "birthday", "birthdt", "bday", "datebirth"] },
  { category: "dateOfBirth", score: 0.8, all: ["birth"] },
  { category: "quasiIdentifier", score: 0.6, exact: ["zip", "zipcode", "postcode", "postalcode", "postal", "gender", "sex", "age", "nationality", "ethnicity", "race", "religion", "maritalstatus", "birthyear", "yearofbirth"] },
  { category: "freeText", score: 0.55, exact: ["notes", "note", "comment", "comments", "description", "bio", "about", "remarks", "message", "body", "feedback", "summary"] },
];

function nameDetections(path: string): Detection[] {
  const segments = path.replace(/\[\]/g, "").split(".");
  const leaf = segments[segments.length - 1] ?? "";
  const parent = segments.length > 1 ? (segments[segments.length - 2] as string) : "";
  const tokens = tokenize(leaf);
  const joined = tokens.join("");
  const out: Detection[] = [];
  for (const rule of NAME_RULES) {
    if (rule.unless?.some((u) => tokens.includes(u))) continue;
    const hit = rule.exact ? rule.exact.includes(joined) : rule.all ? rule.all.every((t) => tokens.includes(t)) : false;
    if (!hit) continue;
    if (rule.category === "personName" && joined === "name" && tokenize(parent).some((t) => NOT_PERSON.includes(t.replace(/s$/, "")))) continue;
    if (rule.category === "personName" && tokens.some((t) => NOT_PERSON.includes(t)) && joined !== "username") continue;
    out.push({ category: rule.category, confidence: rule.score, reasons: [`field name "${leaf}"`] });
  }

  // Context: a parent object hints at the meaning of generic children.
  const parentTokens = tokenize(parent);
  const leafGeneric = ["line1", "line2", "street", "city", "state", "zip", "postcode", "postalcode", "region", "province", "district"].includes(joined);
  if (parentTokens.includes("address") && leafGeneric) {
    out.push({ category: joined === "city" || joined === "state" || joined === "region" ? "quasiIdentifier" : "address", confidence: 0.8, reasons: [`inside "${parent}"`] });
  }
  if (parentTokens.includes("name") && ["first", "last", "middle", "given", "family", "full"].includes(joined)) {
    out.push({ category: "personName", confidence: 0.85, reasons: [`"${leaf}" inside "${parent}"`] });
  }
  if ((parentTokens.includes("card") || parentTokens.includes("payment")) && ["number", "no", "pan"].includes(joined)) {
    out.push({ category: "cardNumber", confidence: 0.85, reasons: [`"${leaf}" inside "${parent}"`] });
  }
  if (["credentials", "auth", "secrets", "keys", "security"].some((t) => parentTokens.includes(t)) && ["value", "key", "secret", "token"].includes(joined)) {
    out.push({ category: "apiKey", confidence: 0.75, reasons: [`"${leaf}" inside "${parent}"`] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Value patterns
// ---------------------------------------------------------------------------

const RE = {
  email: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
  ipv4: /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/,
  ipv6: /^(?=.*:)[0-9a-f:]{2,39}$/i,
  ssn: /^\d{3}-\d{2}-\d{4}$/,
  cardShape: /^\d{4}([ -]?)\d{4}\1\d{4}\1\d{1,7}$|^\d{13,19}$/,
  jwt: /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}$/,
  apiKey: /^(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}$|^AKIA[0-9A-Z]{16}$|^gh[pousr]_[A-Za-z0-9]{30,}$|^xox[abprs]-[A-Za-z0-9-]{10,}$|^AIza[0-9A-Za-z_-]{35}$|^glpat-[A-Za-z0-9_-]{20}$|^-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  passwordHash: /^\$(2[abxy]?|argon2(id|i|d)|scrypt|pbkdf2[-\w]*|[156])\$/,
  phone: /^\+?[\d\s().-]{7,22}$/,
  street: /^\d+[A-Za-z]?\s+([A-Za-z0-9.'-]+\s){0,4}(street|st|avenue|ave|road|rd|lane|ln|drive|dr|way|court|ct|boulevard|blvd|place|pl|terrace|close|crescent|parkway|pkwy|highway|hwy)\b/i,
  date: /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  objectId: /^[0-9a-f]{24}$/i,
  personName: /^[A-Z][a-z'-]+(\s[A-Z][a-z'-]+){1,2}$/,
  idLike: /^[A-Za-z]{0,6}[-_]?\d{1,12}$/,
};

const FIRST = new Set(vocab.FIRST_NAMES.map((n) => n.toLowerCase()));

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function looksLikeSecret(s: string): boolean {
  if (s.length < 24 || s.length > 4096 || /\s/.test(s)) return false;
  if (RE.uuid.test(s) || RE.objectId.test(s) || RE.date.test(s) || RE.email.test(s) || /^https?:\/\//.test(s)) return false;
  if (!/^[A-Za-z0-9+/=_.-]+$/.test(s)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/].filter((r) => r.test(s)).length;
  return classes >= 2 && entropy(s) >= 3.5;
}

function digitCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) n++;
  return n;
}

/** Categories suggested by a single value (used for field classification and safety scanning). */
export function valueCategories(v: unknown): { category: SensitiveCategory; strength: number; reason: string }[] {
  if (typeof v === "number") {
    const s = String(v);
    if (Number.isInteger(v) && s.length >= 13 && s.length <= 19 && luhnValid(s)) return [{ category: "cardNumber", strength: 0.9, reason: "Luhn-valid card-length number" }];
    return [];
  }
  if (typeof v !== "string") return [];
  const s = v.trim();
  if (!s || s.length > 10_000) return [];
  const out: { category: SensitiveCategory; strength: number; reason: string }[] = [];
  if (RE.email.test(s)) out.push({ category: "email", strength: 0.95, reason: "email address pattern" });
  if (RE.jwt.test(s)) out.push({ category: "authToken", strength: 0.95, reason: "JWT pattern" });
  if (RE.apiKey.test(s)) out.push({ category: "apiKey", strength: 0.95, reason: "known API key format" });
  if (RE.passwordHash.test(s)) out.push({ category: "password", strength: 0.9, reason: "password hash format" });
  if (RE.ssn.test(s)) out.push({ category: "governmentId", strength: 0.8, reason: "SSN-like pattern" });
  if (RE.ipv4.test(s) || (RE.ipv6.test(s) && s.split(":").length >= 3)) out.push({ category: "ipAddress", strength: 0.9, reason: "IP address pattern" });
  if (RE.cardShape.test(s)) {
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19) {
      out.push(luhnValid(digits) ? { category: "cardNumber", strength: 0.95, reason: "Luhn-valid card number" } : { category: "cardNumber", strength: 0.45, reason: "card-shaped number" });
    }
  }
  if (!out.length && RE.phone.test(s) && !RE.date.test(s)) {
    const d = digitCount(s);
    const hasSep = /[\s().+-]/.test(s);
    if (d >= 7 && d <= 15 && hasSep) out.push({ category: "phone", strength: s.startsWith("+") ? 0.8 : 0.6, reason: "phone number pattern" });
  }
  if (RE.street.test(s)) out.push({ category: "address", strength: 0.85, reason: "street address pattern" });
  if (RE.personName.test(s)) {
    const first = s.split(/\s/)[0]!.toLowerCase();
    out.push({ category: "personName", strength: FIRST.has(first) ? 0.6 : 0.35, reason: "capitalised multi-word name pattern" });
  }
  if (!out.length && looksLikeSecret(s)) out.push({ category: "authToken", strength: 0.55, reason: "high-entropy token-like string" });
  return out;
}

function valueDetections(samples: readonly unknown[]): Detection[] {
  const values = samples.filter((v) => v !== null && v !== undefined).slice(0, 500);
  if (!values.length) return [];
  const totals = new Map<SensitiveCategory, { sum: number; hits: number; reason: string }>();
  for (const v of values) {
    for (const c of valueCategories(v)) {
      const t = totals.get(c.category) ?? { sum: 0, hits: 0, reason: c.reason };
      t.sum += c.strength;
      t.hits++;
      totals.set(c.category, t);
    }
  }
  const out: Detection[] = [];
  for (const [category, t] of totals) {
    const rate = t.hits / values.length;
    if (rate < 0.3) continue;
    const confidence = (t.sum / t.hits) * (0.5 + 0.5 * rate);
    out.push({ category, confidence: Math.round(confidence * 100) / 100, reasons: [`${Math.round(rate * 100)}% of sampled values match ${t.reason}`] });
  }
  return out;
}

function identifierDetection(path: string, samples: readonly unknown[]): Detection | undefined {
  const leaf = (path.replace(/\[\]/g, "").split(".").pop() ?? "").trim();
  if (!/(^id$|_id$|Id$|ID$|Number$|_no$|No$|Code$|_code$|Ref$)/.test(leaf)) return undefined;
  const values = samples.filter((v) => v !== null && v !== undefined).slice(0, 200);
  if (!values.length) return undefined;
  const idLike = values.filter((v) => (typeof v === "number" && Number.isInteger(v)) || (typeof v === "string" && (RE.idLike.test(v) || RE.uuid.test(v) || RE.objectId.test(v)))).length;
  if (idLike / values.length < 0.8) return undefined;
  return { category: "identifier", confidence: 0.6, reasons: [`identifier-like field "${leaf}" (may link records to real people or entities)`] };
}

/**
 * Classify a field's potential sensitivity from its name, its context (parent
 * path) and sampled values. Detection is heuristic: it identifies *potential*
 * sensitivity and is not a verified privacy guarantee.
 */
export function classifyField(evidence: FieldEvidence): PrivacyClassification {
  const byCategory = new Map<SensitiveCategory, Detection>();
  const add = (d: Detection, combine: boolean) => {
    const prev = byCategory.get(d.category);
    if (!prev) return byCategory.set(d.category, { ...d, reasons: [...d.reasons] });
    prev.confidence = combine ? 1 - (1 - prev.confidence) * (1 - d.confidence) : Math.max(prev.confidence, d.confidence);
    prev.reasons.push(...d.reasons);
  };
  for (const d of nameDetections(evidence.path)) add(d, false);
  for (const d of valueDetections(evidence.samples)) add(d, true);
  if (!byCategory.size) {
    const id = identifierDetection(evidence.path, evidence.samples);
    if (id) add(id, false);
  }

  // Name-only "name" hints with no person-like values are weak.
  const nonNull = evidence.samples.filter((v) => v !== null && v !== undefined);
  const pn = byCategory.get("personName");
  if (pn && nonNull.length && nonNull.every((v) => typeof v !== "string")) byCategory.delete("personName");
  // Value-only name matches on fields that clearly name something else ("companyName", "departments.name").
  const segs = evidence.path.replace(/\[\]/g, "").split(".");
  const leafTokens = tokenize(segs[segs.length - 1] ?? "");
  const parentTokens = tokenize(segs[segs.length - 2] ?? "").map((t) => t.replace(/s$/, ""));
  const nonPersonName = leafTokens.some((t) => NOT_PERSON.includes(t)) || (leafTokens.join("") === "name" && parentTokens.some((t) => NOT_PERSON.includes(t)));
  if (byCategory.has("personName") && nonPersonName && leafTokens.join("") !== "username") byCategory.delete("personName");
  // Date-of-birth names with non-date values are probably something else.
  const dob = byCategory.get("dateOfBirth");
  if (dob && nonNull.length && !nonNull.some((v) => typeof v === "string" && RE.date.test(v)) && !nonNull.some((v) => typeof v === "number")) dob.confidence *= 0.6;

  const detections = Array.from(byCategory.values())
    .map((d) => ({ ...d, confidence: Math.min(0.99, Math.round(d.confidence * 100) / 100) }))
    .sort((a, b) => b.confidence - a.confidence || LEVEL_RANK[CATEGORY_LEVEL[b.category]] - LEVEL_RANK[CATEGORY_LEVEL[a.category]]);

  const top = detections[0];
  if (!top || top.confidence < 0.3) {
    return { level: "none", confidence: top?.confidence ?? 0, detections, uncertain: false, warnings: [] };
  }
  const warnings: string[] = [];
  const uncertain = top.confidence < 0.7;
  if (uncertain) warnings.push(`Possible ${top.category} (confidence ${top.confidence.toFixed(2)}). Review this classification before relying on it.`);
  const second = detections[1];
  if (second && second.confidence >= 0.5 && second.category !== top.category) {
    warnings.push(`Also resembles ${second.category} (confidence ${second.confidence.toFixed(2)}).`);
  }
  if (top.category === "freeText") warnings.push("Free-text fields can contain personal data that pattern detection cannot see.");
  if (top.category === "quasiIdentifier") warnings.push("Quasi-identifiers can re-identify people when combined with other fields.");
  // Highest level among confident detections.
  let level: SensitivityLevel = CATEGORY_LEVEL[top.category];
  for (const d of detections) if (d.confidence >= 0.6 && LEVEL_RANK[CATEGORY_LEVEL[d.category]] > LEVEL_RANK[level]) level = CATEGORY_LEVEL[d.category];
  return { level, category: top.category, confidence: top.confidence, detections, uncertain, warnings };
}

export function isSecretCategory(c: SensitiveCategory | undefined): boolean {
  return c === "password" || c === "authToken" || c === "apiKey";
}

export function compareLevels(a: SensitivityLevel, b: SensitivityLevel): number {
  return LEVEL_RANK[a] - LEVEL_RANK[b];
}
