import type { RequiredSystemPageObjectBinding } from "../execution/systemPageObject.js";

export function validatePageObjectUsage(
  source: string,
  bindings: RequiredSystemPageObjectBinding[]
) {
  const tokens = tokenize(source);
  const missingBindings = bindings.filter(
    ({ pageModelId, locatorPointId }) => !hasBindingCall(tokens, pageModelId, locatorPointId)
  );

  return missingBindings.length
    ? {
        valid: false as const,
        reason: `Generated Playwright test must resolve confirmed System Brain page and locator bindings: ${missingBindings
          .map(({ pageModelId, locatorPointId }) => `${pageModelId}/${locatorPointId}`)
          .join(", ")}.`
      }
    : { valid: true as const };
}

type Token = { kind: "identifier" | "string" | "punctuation" | "template"; value: string };

function hasBindingCall(tokens: Token[], pageModelId: string, locatorPointId: string) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      !isToken(tokens[index], "identifier", "bc") ||
      !isToken(tokens[index + 1], "punctuation", ".") ||
      !isToken(tokens[index + 2], "identifier", "pageObject") ||
      !isToken(tokens[index + 3], "punctuation", "(")
    ) continue;
    const firstArgumentEnd = findArgumentSeparator(tokens, index + 4);
    if (firstArgumentEnd < 0) continue;
    const pageIdIndex = firstArgumentEnd + 1;
    if (
      !isToken(tokens[pageIdIndex], "string", pageModelId) ||
      !isToken(tokens[pageIdIndex + 1], "punctuation", ")") ||
      !isToken(tokens[pageIdIndex + 2], "punctuation", ".") ||
      !isToken(tokens[pageIdIndex + 3], "identifier", "control") ||
      !isToken(tokens[pageIdIndex + 4], "punctuation", "(") ||
      !isToken(tokens[pageIdIndex + 5], "string", locatorPointId) ||
      !isToken(tokens[pageIdIndex + 6], "punctuation", ")")
    ) continue;
    return true;
  }
  return false;
}

function findArgumentSeparator(tokens: Token[], start: number) {
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "punctuation") continue;
    if (token.value === "(" ) parens += 1;
    else if (token.value === ")") {
      if (parens === 0 && brackets === 0 && braces === 0) return -1;
      parens -= 1;
    } else if (token.value === "[") brackets += 1;
    else if (token.value === "]") brackets -= 1;
    else if (token.value === "{") braces += 1;
    else if (token.value === "}") braces -= 1;
    else if (token.value === "," && parens === 0 && brackets === 0 && braces === 0) return index;
  }
  return -1;
}

function isToken(token: Token | undefined, kind: Token["kind"], value: string) {
  return token?.kind === kind && token.value === value;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      index = skipLine(source, index + 2);
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      index = skipBlock(source, index + 2);
      continue;
    }
    if (char === "'" || char === '"') {
      const literal = readQuoted(source, index, char);
      tokens.push({ kind: "string", value: literal.value });
      index = literal.end;
      continue;
    }
    if (char === "`") {
      index = skipTemplate(source, index + 1);
      tokens.push({ kind: "template", value: "" });
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index++;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      tokens.push({ kind: "identifier", value: source.slice(start, index) });
      continue;
    }
    tokens.push({ kind: "punctuation", value: char });
    index += 1;
  }
  return tokens;
}

function readQuoted(source: string, start: number, quote: string) {
  let index = start + 1;
  let value = "";
  while (index < source.length) {
    const char = source[index++];
    if (char === quote) return { value, end: index };
    if (char !== "\\") {
      value += char;
      continue;
    }
    const escaped = source[index++];
    const replacements: Record<string, string> = {
      n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0"
    };
    value += replacements[escaped] ?? escaped;
  }
  return { value: "", end: source.length };
}

function skipLine(source: string, start: number) {
  const newline = source.indexOf("\n", start);
  return newline < 0 ? source.length : newline + 1;
}

function skipBlock(source: string, start: number) {
  const end = source.indexOf("*/", start);
  return end < 0 ? source.length : end + 2;
}

function skipTemplate(source: string, start: number) {
  let index = start;
  while (index < source.length) {
    if (source[index] === "\\") index += 2;
    else if (source[index++] === "`") break;
  }
  return index;
}
