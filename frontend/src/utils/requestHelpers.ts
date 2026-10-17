/**
 * Shared helpers for building outgoing requests. They mirror the Go runner
 * (automation_runner.go) so a request behaves the same in the Request tab and
 * in Automation.
 */

const TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Base64 of the UTF-8 bytes of `text` (btoa alone throws on non-Latin-1). */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Decodes Base64 holding UTF-8 bytes (inverse of utf8ToBase64). */
export function base64ToUtf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export type VariableResolver = (name: string) => string | undefined;

/** Plain substitution for bodies, headers and other non-URL text. */
export function interpolateText(text: string, resolve: VariableResolver): string {
  if (!text) return text;
  return text.replace(TEMPLATE_PATTERN, (match, name: string) => {
    const value = resolve(name.trim());
    return value === undefined ? match : value;
  });
}

const encodePathValue = (value: string) =>
  value.replace(/[%?# \t\r\n]/g, c => encodeURIComponent(c));
const encodeRawQueryValue = (value: string) =>
  value.replace(/[# \t\r\n]/g, c => encodeURIComponent(c));

/**
 * Substitutes {{variables}} in a URL template, encoding each value for the
 * part of the URL it lands in: the scheme/host (or a leading base-URL
 * variable) is inserted verbatim, path values cannot inject "?" or "#", and
 * query values after "=" are fully encoded so "a&admin=true" stays one value.
 */
export function interpolateUrlTemplate(template: string, resolve: VariableResolver): string {
  if (!template || !template.includes('{{')) return template;
  type Part = 'authority' | 'path' | 'query' | 'fragment';
  let part: Part = 'path';
  let start = 0;
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(template);
  if (scheme) {
    part = 'authority';
    start = scheme[0].length;
  } else if (!template.startsWith('/') && !template.startsWith('?')) {
    part = 'authority';
  }
  let out = template.slice(0, start);
  let lastLiteral = '';
  const advance = (literal: string) => {
    for (const c of literal) {
      if (part === 'authority' && c === '/') part = 'path';
      else if ((part === 'authority' || part === 'path') && c === '?') part = 'query';
      else if (part !== 'fragment' && c === '#') part = 'fragment';
      lastLiteral = c;
    }
    out += literal;
  };
  const pattern = new RegExp(TEMPLATE_PATTERN.source, 'g');
  pattern.lastIndex = start;
  let cursor = start;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    advance(template.slice(cursor, match.index));
    const value = resolve(match[1].trim());
    if (value === undefined) {
      out += match[0];
    } else if (part === 'authority') {
      out += value;
    } else if (part === 'path') {
      out += encodePathValue(value);
    } else if (part === 'query') {
      out += lastLiteral === '=' ? encodeURIComponent(value) : encodeRawQueryValue(value);
    } else {
      out += encodeURIComponent(value);
    }
    cursor = match.index + match[0].length;
  }
  advance(template.slice(cursor));
  return out;
}

/**
 * Encodes a query component but keeps {{variables}} literal so they are still
 * substituted at send time (URLSearchParams would turn them into %7B%7B…%7D%7D).
 */
export function encodeQueryComponentKeepingTemplates(value: string): string {
  let out = '';
  let cursor = 0;
  const pattern = new RegExp(TEMPLATE_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    out += encodeURIComponent(value.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  return out + encodeURIComponent(value.slice(cursor));
}

export function buildQueryStringKeepingTemplates(params: { key: string; value: string }[]): string {
  return params
    .map(p => `${encodeQueryComponentKeepingTemplates(p.key)}=${encodeQueryComponentKeepingTemplates(p.value)}`)
    .join('&');
}

/** Parses "a=1&b={{x}}" without turning "+" into spaces inside templates. */
export function parseQueryString(query: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    const decode = (s: string) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
      } catch {
        return s;
      }
    };
    out.push({ key: decode(rawKey), value: decode(rawValue) });
  }
  return out;
}

/** Sets a header, replacing any existing entry whose name differs only in case. */
export function setHeader(headers: Record<string, string>, name: string, value: string) {
  for (const existing of Object.keys(headers)) {
    if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
  }
  headers[name] = value;
}

export function newId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns true for URLs that are safe to open from scraped/untrusted content. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
