import { luhnValid } from "@workfonic/dataghost-generators";
import { valueCategories, type SensitiveCategory } from "./detect.js";

export interface SafetyFinding {
  location: string;
  category: SensitiveCategory;
  message: string;
}

const SAFE_EMAIL = /@((?:[a-z0-9-]+\.)*example\.(com|org|net)|(?:[a-z0-9-]+\.)*[a-z0-9-]+\.(test|example|invalid|localhost))$/i;
const DOC_IPV4 = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/;
const DOC_IPV6 = /^2001:db8:/i;
const FICTIONAL_PHONE = /555[-\s.]?01\d{2}$|7700\s?900\d{3}$/;

/**
 * Scan a value for content that looks real rather than synthetic: emails on
 * non-reserved domains, Luhn-valid card numbers, non-documentation IPs,
 * credential formats. Used by `dataghost validate` on generated output.
 * A clean scan is not proof that data is safe.
 */
export function scanValue(value: unknown, location: string): SafetyFinding[] {
  const out: SafetyFinding[] = [];
  for (const c of valueCategories(value)) {
    const s = String(value);
    switch (c.category) {
      case "email":
        if (!SAFE_EMAIL.test(s)) out.push({ location, category: "email", message: "email address does not use a reserved test domain" });
        break;
      case "ipAddress":
        if (!DOC_IPV4.test(s) && !DOC_IPV6.test(s) && s.split(".").length === 4) {
          out.push({ location, category: "ipAddress", message: "IP address is outside the documentation ranges" });
        }
        break;
      case "cardNumber":
        if (luhnValid(s.replace(/\D/g, ""))) out.push({ location, category: "cardNumber", message: "Luhn-valid card number" });
        break;
      case "apiKey":
      case "authToken":
      case "password":
        if (c.strength >= 0.9 && !s.startsWith("dg_test_")) out.push({ location, category: c.category, message: `value matches a real ${c.category} format` });
        break;
      case "governmentId":
        if (!s.startsWith("000-")) out.push({ location, category: "governmentId", message: "government-identifier-shaped value outside the never-issued 000 area" });
        break;
      case "phone":
        if (s.startsWith("+") && !FICTIONAL_PHONE.test(s)) out.push({ location, category: "phone", message: "phone number is not in a fictional range" });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Recursively scan a record. */
export function scanRecord(record: unknown, prefix = ""): SafetyFinding[] {
  const out: SafetyFinding[] = [];
  const walk = (node: unknown, loc: string, depth: number) => {
    if (depth > 32) return;
    if (Array.isArray(node)) node.forEach((el, i) => walk(el, `${loc}[${i}]`, depth + 1));
    else if (node !== null && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, loc ? `${loc}.${k}` : k, depth + 1);
    else out.push(...scanValue(node, loc));
  };
  walk(record, prefix, 0);
  return out;
}
