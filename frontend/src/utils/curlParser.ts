import { base64ToUtf8, newId, parseQueryString } from './requestHelpers';

type Row = { id: string; key: string; value: string; enabled: boolean };
type FormRow = Row & { type: 'text' | 'file'; filePath?: string };

export interface ParsedCurlResult {
  method: string;
  baseUrl: string;
  port: string;
  usePort: boolean;
  apiPath: string;
  headers: Row[];
  params: Row[];
  body: string;
  bodyType: string;
  urlEncoded: Row[];
  formData: FormRow[];
  authType: string;
  authToken: string;
  authConfig?: any;
}

/**
 * Splits a command line following POSIX shell quoting: single quotes are
 * literal, double quotes honour \" \\ \$ \` escapes, a backslash outside quotes
 * escapes the next character, $'...' supports ANSI-C escapes, and adjacent
 * quoted pieces form one word ('It'\''s' → It's). Whitespace inside quotes is
 * preserved exactly.
 */
export function tokenizeShell(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let i = 0;
  const ansiEscapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v', '0': '\0' };

  while (i < input.length) {
    const c = input[i];
    if (c === '\\' && (input[i + 1] === '\n' || (input[i + 1] === '\r' && input[i + 2] === '\n'))) {
      i += input[i + 1] === '\r' ? 3 : 2; // line continuation
      continue;
    }
    if (/\s/.test(c)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      i++;
      continue;
    }
    inToken = true;
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      const stop = end === -1 ? input.length : end;
      current += input.slice(i + 1, stop);
      i = stop + 1;
    } else if (c === '$' && input[i + 1] === "'") {
      i += 2;
      while (i < input.length && input[i] !== "'") {
        if (input[i] === '\\' && i + 1 < input.length) {
          const next = input[i + 1];
          if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(input.slice(i + 2, i + 4))) {
            current += String.fromCharCode(parseInt(input.slice(i + 2, i + 4), 16));
            i += 4;
            continue;
          }
          current += ansiEscapes[next] ?? next;
          i += 2;
        } else {
          current += input[i++];
        }
      }
      i++;
    } else if (c === '"') {
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          const next = input[i + 1];
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            current += next;
            i += 2;
            continue;
          }
          if (next === '\n') {
            i += 2;
            continue;
          }
        }
        current += input[i++];
      }
      i++;
    } else if (c === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i += 2;
    } else {
      current += c;
      i++;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

/** Splits "user:pa:ss" at the first colon only (RFC 7617). */
function splitCredentials(value: string): { username: string; password: string } {
  const idx = value.indexOf(':');
  return idx === -1 ? { username: value, password: '' } : { username: value.slice(0, idx), password: value.slice(idx + 1) };
}

function encodeDataUrlencode(value: string): string {
  // curl --data-urlencode forms: "content", "=content", "name=content", "name@file"
  const eq = value.indexOf('=');
  if (eq === -1) return encodeURIComponent(value);
  const name = value.slice(0, eq);
  const content = encodeURIComponent(value.slice(eq + 1));
  return name ? `${name}=${content}` : content;
}

// Flags that take a value we do not use (so the value is not mistaken for the URL).
const IGNORED_VALUE_FLAGS = new Set([
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '--retry', '-w', '--write-out', '-x', '--proxy',
  '--cert', '-E', '--key', '--cacert', '--capath', '-r', '--range', '-T', '--upload-file', '-c', '--cookie-jar',
  '--resolve', '--max-redirs', '-K', '--config', '--limit-rate', '-U', '--proxy-user', '--interface', '-z', '--time-cond'
]);

export function parseCurl(curlText: string): ParsedCurlResult | null {
  if (!curlText || !curlText.trim()) return null;

  // Windows cmd "Copy as cURL" uses ^ line continuations.
  const normalized = curlText.replace(/\^\r?\n/g, ' ').trim();
  const tokens = tokenizeShell(normalized);
  if (tokens.length === 0 || !/^curl(\.exe)?$/i.test(tokens[0])) {
    return null;
  }

  let method = '';
  let targetUrl = '';
  let forceGet = false;
  const headers: Row[] = [];
  const dataParts: string[] = [];
  const formData: FormRow[] = [];
  let authType = 'none';
  let authToken = '';
  let authConfig: any = {};

  const addHeader = (key: string, value: string) => {
    headers.push({ id: newId('h'), key, value, enabled: true });
  };
  const handleHeader = (headerStr: string) => {
    const colonIdx = headerStr.indexOf(':');
    if (colonIdx <= 0) return;
    const key = headerStr.slice(0, colonIdx).trim();
    const val = headerStr.slice(colonIdx + 1).trim();
    if (key.toLowerCase() === 'authorization') {
      if (/^bearer\s+/i.test(val)) {
        authType = 'bearer';
        authToken = val.replace(/^bearer\s+/i, '').trim();
        return;
      }
      if (/^basic\s+/i.test(val)) {
        try {
          authConfig = splitCredentials(base64ToUtf8(val.replace(/^basic\s+/i, '').trim()));
          authType = 'basic';
          return;
        } catch {
          // not valid base64: keep the raw header below
        }
      }
    }
    addHeader(key, val);
  };

  for (let i = 1; i < tokens.length; i++) {
    let token = tokens[i];
    let inlineValue: string | undefined;
    // --long=value and -Xvalue forms
    if (token.startsWith('--') && token.includes('=')) {
      inlineValue = token.slice(token.indexOf('=') + 1);
      token = token.slice(0, token.indexOf('='));
    } else if (/^-[XHdubAeF][^\s]/.test(token)) {
      inlineValue = token.slice(2);
      token = token.slice(0, 2);
    }
    const takeValue = () => (inlineValue !== undefined ? inlineValue : tokens[++i] ?? '');

    switch (token) {
      case '-X':
      case '--request':
        method = takeValue().toUpperCase();
        break;
      case '-H':
      case '--header':
        handleHeader(takeValue());
        break;
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        dataParts.push(takeValue());
        break;
      case '--data-urlencode':
        dataParts.push(encodeDataUrlencode(takeValue()));
        break;
      case '--json':
        dataParts.push(takeValue());
        if (!headers.some(h => h.key.toLowerCase() === 'content-type')) addHeader('Content-Type', 'application/json');
        break;
      case '-F':
      case '--form':
      case '--form-string': {
        const value = takeValue();
        const eq = value.indexOf('=');
        const key = eq === -1 ? value : value.slice(0, eq);
        const content = eq === -1 ? '' : value.slice(eq + 1);
        if (token !== '--form-string' && content.startsWith('@')) {
          formData.push({ id: newId('f'), key, value: '', enabled: true, type: 'file', filePath: content.slice(1).split(';')[0] });
        } else {
          formData.push({ id: newId('f'), key, value: token === '--form-string' ? content : content.replace(/^</, ''), enabled: true, type: 'text' });
        }
        break;
      }
      case '-u':
      case '--user':
        authType = 'basic';
        authConfig = splitCredentials(takeValue());
        break;
      case '-A':
      case '--user-agent':
        addHeader('User-Agent', takeValue());
        break;
      case '-b':
      case '--cookie':
        addHeader('Cookie', takeValue());
        break;
      case '-e':
      case '--referer':
        addHeader('Referer', takeValue());
        break;
      case '--url':
        targetUrl = takeValue();
        break;
      case '-G':
      case '--get':
        forceGet = true;
        break;
      default:
        if (IGNORED_VALUE_FLAGS.has(token)) {
          takeValue();
        } else if (!token.startsWith('-') && !targetUrl) {
          targetUrl = token;
        }
    }
  }

  // curl joins repeated -d values with "&"
  let body = dataParts.join('&');
  let urlForParsing = targetUrl;
  if (forceGet && body) {
    urlForParsing += (urlForParsing.includes('?') ? '&' : '?') + body;
    body = '';
  }
  if (!method) {
    method = body || formData.length ? 'POST' : 'GET';
  }

  // Parse URL components without requiring a valid absolute URL ({{vars}} allowed)
  let baseUrl = urlForParsing;
  let port = '8080';
  let usePort = false;
  let apiPath = '';
  const params: Row[] = [];
  const match = /^((?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?)((?:\{\{[^}]*\}\}|[^/?#])*)(.*)$/.exec(urlForParsing);
  if (match) {
    let authority = match[2];
    const portMatch = /:(\d+)$/.exec(authority);
    if (portMatch && authority.lastIndexOf(']') < portMatch.index) {
      port = portMatch[1];
      usePort = true;
      authority = authority.slice(0, portMatch.index);
    }
    const scheme = match[1] || (authority.startsWith('{{') ? '' : 'http://');
    baseUrl = `${scheme}${authority}`;
    apiPath = match[3].split('#')[0];
    if (apiPath && !apiPath.startsWith('/')) apiPath = '/' + apiPath;
    const q = apiPath.indexOf('?');
    if (q !== -1) {
      parseQueryString(apiPath.slice(q + 1)).forEach(({ key, value }) => params.push({ id: newId('p'), key, value, enabled: true }));
    }
  }

  const contentType = headers.find(h => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() || '';
  let bodyType = body ? 'raw' : 'none';
  let urlEncoded: Row[] = [];
  const looksJson = (() => {
    const t = body.trim();
    if (!t || !(t.startsWith('{') || t.startsWith('['))) return false;
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  })();
  if (formData.length) {
    bodyType = 'formdata';
    body = '';
  } else if (body && (contentType.includes('json') || looksJson)) {
    bodyType = 'json';
  } else if (body && (contentType.includes('x-www-form-urlencoded') || (!contentType && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body)))) {
    bodyType = 'urlencoded';
    urlEncoded = parseQueryString(body).map(({ key, value }) => ({ id: newId('u'), key, value, enabled: true }));
    body = '';
  }

  if (bodyType === 'json' && !contentType) {
    addHeader('Content-Type', 'application/json');
  }

  return {
    method,
    baseUrl,
    port,
    usePort,
    apiPath,
    headers,
    params,
    body,
    bodyType,
    urlEncoded,
    formData,
    authType,
    authToken,
    authConfig
  };
}

/** Quotes a value for POSIX shells: 'It'\''s'. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function generateCurlSnippet(method: string, fullUrl: string, headers: Record<string, string>, body: string): string {
  let cmd = `curl -X ${method.toUpperCase()} ${shellQuote(fullUrl)}`;

  Object.entries(headers).forEach(([k, v]) => {
    cmd += ` \\\n  -H ${shellQuote(`${k}: ${v}`)}`;
  });

  if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
    cmd += ` \\\n  --data-raw ${shellQuote(body)}`;
  }

  return cmd;
}

const hasBody = (method: string, body: string) => !!body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

function parseJsonBody(body: string): { ok: true; value: any } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

export function generateCodeSnippet(
  lang: 'curl' | 'fetch' | 'axios' | 'python' | 'go' | 'nodejs',
  method: string,
  fullUrl: string,
  headers: Record<string, string>,
  body: string
): string {
  const m = method.toUpperCase();
  // JSON string literals are valid string literals in JS, Python and Go, so
  // every user value is embedded through JSON.stringify instead of raw quotes.
  const lit = (value: string) => JSON.stringify(value);
  const withBody = hasBody(m, body);
  const json = withBody ? parseJsonBody(body) : { ok: false as const };

  switch (lang) {
    case 'curl':
      return generateCurlSnippet(method, fullUrl, headers, body);

    case 'fetch': {
      const lines = [`  method: ${lit(m)},`, `  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')},`];
      if (withBody) {
        lines.push(json.ok ? `  body: JSON.stringify(${JSON.stringify(json.value, null, 2).replace(/\n/g, '\n  ')}),` : `  body: ${lit(body)},`);
      }
      return `fetch(${lit(fullUrl)}, {
${lines.join('\n')}
})
  .then(response => response.text())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`;
    }

    case 'axios': {
      const dataLine = withBody
        ? `\n  data: ${json.ok ? JSON.stringify(json.value, null, 2).replace(/\n/g, '\n  ') : lit(body)},`
        : '';
      return `import axios from 'axios';

const config = {
  method: ${lit(m.toLowerCase())},
  url: ${lit(fullUrl)},
  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')},${dataLine}
};

axios(config)
  .then(response => {
    console.log(response.data);
  })
  .catch(error => {
    console.error(error);
  });`;
    }

    case 'python': {
      let payloadLines = 'payload = None';
      let call = `requests.request(${lit(m)}, url, headers=headers)`;
      if (withBody) {
        if (json.ok) {
          payloadLines = `payload = json.loads(${lit(JSON.stringify(json.value))})`;
          call = `requests.request(${lit(m)}, url, headers=headers, json=payload)`;
        } else {
          payloadLines = `payload = ${lit(body)}`;
          call = `requests.request(${lit(m)}, url, headers=headers, data=payload.encode("utf-8"))`;
        }
      }
      const headerLines = Object.entries(headers).map(([k, v]) => `    ${lit(k)}: ${lit(v)},`).join('\n');
      return `import json
import requests

url = ${lit(fullUrl)}
headers = {
${headerLines}
}
${payloadLines}

response = ${call}

print(response.status_code)
print(response.text)`;
    }

    case 'go': {
      const headerLines = Object.entries(headers)
        .map(([k, v]) => `\treq.Header.Add(${lit(k)}, ${lit(v)})`)
        .join('\n');
      return `package main

import (
\t"fmt"
\t"io"
\t"net/http"
\t"strings"
)

func main() {
\turl := ${lit(fullUrl)}
\tmethod := ${lit(m)}

\tvar payload io.Reader
\t${withBody ? `payload = strings.NewReader(${lit(body)})` : 'payload = nil'}

\tclient := &http.Client{}
\treq, err := http.NewRequest(method, url, payload)
\tif err != nil {
\t\tfmt.Println(err)
\t\treturn
\t}
${headerLines}

\tres, err := client.Do(req)
\tif err != nil {
\t\tfmt.Println(err)
\t\treturn
\t}
\tdefer res.Body.Close()

\tbody, err := io.ReadAll(res.Body)
\tif err != nil {
\t\tfmt.Println(err)
\t\treturn
\t}
\tfmt.Println(string(body))
}`;
    }

    case 'nodejs': {
      const isHttps = fullUrl.toLowerCase().startsWith('https:');
      return `const ${isHttps ? 'https' : 'http'} = require('${isHttps ? 'https' : 'http'}');

const options = {
  method: ${lit(m)},
  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')}
};

const req = ${isHttps ? 'https' : 'http'}.request(${lit(fullUrl)}, options, (res) => {
  const chunks = [];

  res.on('data', (chunk) => {
    chunks.push(chunk);
  });

  res.on('end', () => {
    console.log(Buffer.concat(chunks).toString());
  });
});

req.on('error', (error) => {
  console.error(error);
});
${withBody ? `\nreq.write(${lit(body)});` : ''}
req.end();`;
    }

    default:
      return '';
  }
}
