/**
 * A small, safe generator for a subset of regular-expression syntax.
 *
 * Supported: literals, escapes (\d \w \s \D \W \. \- etc.), character classes
 * ([a-z0-9_], negation is not supported), groups ( ... ) and non-capturing
 * groups (?: ... ), alternation |, and quantifiers ? * + {n} {n,} {n,m}.
 * Anchors ^ and $ are accepted and ignored.
 *
 * Rejected: backreferences, lookarounds, named groups, negated classes,
 * Unicode property escapes. Unbounded quantifiers are capped so output length
 * is always bounded. The pattern is parsed, never compiled or executed.
 */
import type { Rng } from "./rng.js";

type Node =
  | { kind: "literal"; value: string }
  | { kind: "class"; chars: string }
  | { kind: "group"; alternatives: Node[][] }
  | { kind: "repeat"; node: Node; min: number; max: number };

export class PatternError extends Error {
  constructor(message: string, readonly pattern: string) {
    super(`Unsupported pattern "${pattern}": ${message}`);
    this.name = "PatternError";
  }
}

const DIGITS = "0123456789";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = LOWER.toUpperCase();
const WORD = LOWER + UPPER + DIGITS + "_";
const SPACE = " ";
const PRINTABLE = LOWER + UPPER + DIGITS + "-_.";
const MAX_PATTERN_LENGTH = 500;
const UNBOUNDED_CAP = 8;
const MAX_REPEAT = 256;

export interface CompiledPattern {
  source: string;
  generate(rng: Rng): string;
}

export function compilePattern(source: string): CompiledPattern {
  if (source.length > MAX_PATTERN_LENGTH) {
    throw new PatternError(`pattern longer than ${MAX_PATTERN_LENGTH} characters`, source.slice(0, 40) + "...");
  }
  let pos = 0;

  const peek = () => source[pos];
  const eat = () => source[pos++];

  function parseEscape(inClass: boolean): Node {
    const c = eat();
    if (c === undefined) throw new PatternError("dangling escape", source);
    switch (c) {
      case "d":
        return { kind: "class", chars: DIGITS };
      case "w":
        return { kind: "class", chars: WORD };
      case "s":
        return { kind: "class", chars: SPACE };
      case "D":
        return { kind: "class", chars: LOWER + UPPER };
      case "W":
        return { kind: "class", chars: "-." };
      case "S":
        return { kind: "class", chars: PRINTABLE };
      case "b":
      case "B":
        if (inClass) throw new PatternError("\\b inside a class", source);
        return { kind: "literal", value: "" };
      case "p":
      case "P":
      case "k":
        throw new PatternError(`\\${c} escapes are not supported`, source);
      default:
        if (/[1-9]/.test(c)) throw new PatternError("backreferences are not supported", source);
        return { kind: "literal", value: c };
    }
  }

  function parseClass(): Node {
    // assumes '[' consumed
    if (peek() === "^") throw new PatternError("negated character classes are not supported", source);
    let chars = "";
    let first = true;
    while (pos < source.length && (peek() !== "]" || first)) {
      first = false;
      let c = eat() as string;
      if (c === "\\") {
        const node = parseEscape(true);
        chars += node.kind === "class" ? node.chars : node.kind === "literal" ? node.value : "";
        continue;
      }
      if (peek() === "-" && source[pos + 1] !== undefined && source[pos + 1] !== "]") {
        eat();
        let end = eat() as string;
        if (end === "\\") end = eat() as string;
        const a = c.charCodeAt(0);
        const b = end.charCodeAt(0);
        if (b < a) throw new PatternError(`invalid range ${c}-${end}`, source);
        if (b - a > 1000) throw new PatternError(`range ${c}-${end} too large`, source);
        for (let code = a; code <= b; code++) chars += String.fromCharCode(code);
        continue;
      }
      c = c ?? "";
      chars += c;
    }
    if (eat() !== "]") throw new PatternError("unterminated character class", source);
    if (chars.length === 0) throw new PatternError("empty character class", source);
    return { kind: "class", chars: Array.from(new Set(chars)).join("") };
  }

  function parseAtom(): Node | null {
    const c = peek();
    if (c === undefined || c === "|" || c === ")") return null;
    eat();
    switch (c) {
      case "\\":
        return parseEscape(false);
      case "[":
        return parseClass();
      case "(": {
        if (peek() === "?") {
          eat();
          if (peek() !== ":") throw new PatternError("lookarounds and named groups are not supported", source);
          eat();
        }
        const alternatives = parseAlternatives();
        if (eat() !== ")") throw new PatternError("unterminated group", source);
        return { kind: "group", alternatives };
      }
      case ".":
        return { kind: "class", chars: PRINTABLE };
      case "^":
      case "$":
        return { kind: "literal", value: "" };
      case "*":
      case "+":
      case "?":
      case "{":
        throw new PatternError(`quantifier "${c}" has nothing to repeat`, source);
      default:
        return { kind: "literal", value: c };
    }
  }

  function parseQuantifier(node: Node): Node {
    const c = peek();
    let min: number;
    let max: number;
    if (c === "?") {
      eat();
      min = 0;
      max = 1;
    } else if (c === "*") {
      eat();
      min = 0;
      max = UNBOUNDED_CAP;
    } else if (c === "+") {
      eat();
      min = 1;
      max = UNBOUNDED_CAP;
    } else if (c === "{") {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(pos));
      if (!m) throw new PatternError('invalid quantifier (escape literal braces as "\\{")', source);
      pos += m[0].length;
      min = Number(m[1]);
      max = m[2] === undefined ? min : m[3] === "" ? min + UNBOUNDED_CAP : Number(m[3]);
      if (max < min) throw new PatternError(`invalid quantifier ${m[0]}`, source);
      if (max > MAX_REPEAT) throw new PatternError(`quantifier ${m[0]} exceeds ${MAX_REPEAT}`, source);
    } else {
      return node;
    }
    if (peek() === "?" || peek() === "+") eat(); // lazy / possessive: same output space
    return { kind: "repeat", node, min, max };
  }

  function parseSequence(): Node[] {
    const seq: Node[] = [];
    for (;;) {
      const atom = parseAtom();
      if (!atom) break;
      seq.push(parseQuantifier(atom));
    }
    return seq;
  }

  function parseAlternatives(): Node[][] {
    const alts: Node[][] = [parseSequence()];
    while (peek() === "|") {
      eat();
      alts.push(parseSequence());
    }
    return alts;
  }

  const root = parseAlternatives();
  if (pos < source.length) throw new PatternError(`unexpected "${source[pos]}"`, source);
  const tree: Node = { kind: "group", alternatives: root };

  function gen(node: Node, rng: Rng): string {
    switch (node.kind) {
      case "literal":
        return node.value;
      case "class":
        return node.chars[rng.int(0, node.chars.length - 1)] as string;
      case "group": {
        const alt = rng.pick(node.alternatives);
        let s = "";
        for (const n of alt) s += gen(n, rng);
        return s;
      }
      case "repeat": {
        const times = rng.int(node.min, node.max);
        let s = "";
        for (let i = 0; i < times; i++) s += gen(node.node, rng);
        return s;
      }
    }
  }

  return { source, generate: (rng) => gen(tree, rng) };
}
