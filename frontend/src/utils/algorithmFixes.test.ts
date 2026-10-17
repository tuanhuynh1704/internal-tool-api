import { describe, expect, it } from 'vitest';
import {
  buildQueryStringKeepingTemplates,
  interpolateUrlTemplate,
  isSafeExternalUrl,
  parseQueryString,
  setHeader,
  utf8ToBase64,
  base64ToUtf8
} from './requestHelpers';
import { generateCodeSnippet, generateCurlSnippet, parseCurl } from './curlParser';
import {
  computeNumberStats,
  exportToCsvString,
  extractNumbersFromText,
  parseHtmlData,
  parseJsonData,
  parseLocalizedNumber,
  queryByRegex
} from './dataHarvesterEngine';
import { normalizeDataToTable } from './exportHelper';
import { parseAssertionsString, stringifyAssertions, parseExtractVarsString, AssertionRule } from './excelScenarioHelper';
import { evaluateAssertion, getJsonPathValue, resolveTemplateVariables } from './scenarioRunnerEngine';
import { escapeStack, handleEscapeKey, nextEscapeOrder, pushEscapeHandler } from '../hooks/useEscapeKey';

const nums = (text: string) => extractNumbersFromText(text, 'x').map(n => `${n.type}:${n.value}`);

describe('request helpers (H7, M6, M7, C5)', () => {
  it('keeps {{variables}} literal in generated query strings', () => {
    expect(buildQueryStringKeepingTemplates([{ key: 'token', value: '{{token}}' }, { key: 'q', value: 'a b&c' }]))
      .toBe('token={{token}}&q=a%20b%26c');
  });

  it('encodes variable values for the URL component they land in', () => {
    const vars: Record<string, string> = { base: 'https://api.test/v1', id: 'a b?#', q: 'x&admin=true' };
    expect(interpolateUrlTemplate('{{base}}/users/{{id}}?f={{q}}', n => vars[n]))
      .toBe('https://api.test/v1/users/a%20b%3F%23?f=x%26admin%3Dtrue');
  });

  it('parses query strings without mangling templates', () => {
    expect(parseQueryString('a=1&b={{x}}&c=%20')).toEqual([{ key: 'a', value: '1' }, { key: 'b', value: '{{x}}' }, { key: 'c', value: ' ' }]);
  });

  it('encodes Basic credentials as UTF-8 instead of throwing', () => {
    const encoded = utf8ToBase64('admin:mật khẩu');
    expect(base64ToUtf8(encoded)).toBe('admin:mật khẩu');
  });

  it('replaces headers case-insensitively', () => {
    const headers: Record<string, string> = { authorization: 'manual' };
    setHeader(headers, 'Authorization', 'Bearer x');
    expect(headers).toEqual({ Authorization: 'Bearer x' });
  });

  it('only allows http(s) links to be opened', () => {
    expect(isSafeExternalUrl('https://a.test')).toBe(true);
    expect(isSafeExternalUrl(' JavaScript:alert(1)')).toBe(false);
  });
});

describe('cURL parser (M3, L2)', () => {
  it('preserves whitespace inside quotes and handles escapes', () => {
    const r = parseCurl(`curl -X POST 'https://x.io/a' -H 'Content-Type: application/json' -d '{"name":"a  b"}'`)!;
    expect(r.body).toBe('{"name":"a  b"}');
    const r2 = parseCurl(`curl -X POST "https://x.io/a" -d "{\\"k\\":\\"v\\"}"`)!;
    expect(r2.body).toBe('{"k":"v"}');
  });

  it('round-trips its own generated command', () => {
    const cmd = generateCurlSnippet('POST', 'https://x.io/a', { 'X-Note': "it's" }, "It's");
    const r = parseCurl(cmd)!;
    expect(r.body).toBe("It's");
    expect(r.headers.find(h => h.key === 'X-Note')?.value).toBe("it's");
  });

  it('splits credentials at the first colon only', () => {
    expect(parseCurl(`curl -u 'user:pa:ss' https://x.io`)!.authConfig).toEqual({ username: 'user', password: 'pa:ss' });
    const basic = parseCurl(`curl https://x.io -H 'Authorization: Basic ${utf8ToBase64('u:p:q')}'`)!;
    expect(basic.authConfig).toEqual({ username: 'u', password: 'p:q' });
  });

  it('supports attached flags, --url, repeated -d and -G', () => {
    const r = parseCurl(`curl -XPUT --url https://x.io/a -d a=1 -d b=2`)!;
    expect(r.method).toBe('PUT');
    expect(r.urlEncoded.map(u => `${u.key}=${u.value}`)).toEqual(['a=1', 'b=2']);
    const g = parseCurl(`curl -G https://x.io/s -d q=1`)!;
    expect(g.method).toBe('GET');
    expect(g.apiPath).toBe('/s?q=1');
  });

  it('keeps IPv6 brackets and does not add Content-Type to a GET', () => {
    const r = parseCurl(`curl http://[::1]:8080/health`)!;
    expect(r.baseUrl).toBe('http://[::1]');
    expect(r.port).toBe('8080');
    expect(r.headers).toEqual([]);
  });

  it('generates code that embeds values as valid string literals', () => {
    const go = generateCodeSnippet('go', 'POST', 'https://x.io', { 'X-Q': 'a"b' }, 'body with `backtick`');
    expect(go).toContain('req.Header.Add("X-Q", "a\\"b")');
    expect(go).toContain('strings.NewReader("body with `backtick`")');
    const py = generateCodeSnippet('python', 'POST', 'https://x.io', {}, '{"ok":true,"v":null}');
    expect(py).toContain('json.loads(');
    expect(py).not.toMatch(/payload = \{"ok":true/);
  });
});

describe('data harvester numbers (H8, M8, L1, M9)', () => {
  it('parses Vietnamese and international number formats', () => {
    expect(parseLocalizedNumber('1.500.000')).toBe(1500000);
    expect(parseLocalizedNumber('32,990,000')).toBe(32990000);
    expect(parseLocalizedNumber('1,099.00')).toBe(1099);
    expect(parseLocalizedNumber('1.234,56')).toBe(1234.56);
    expect(parseLocalizedNumber('1,5')).toBe(1.5);
    expect(parseLocalizedNumber('49.50')).toBe(49.5);
  });

  it('extracts prices with units and avoids false positives', () => {
    expect(nums('Giá: 1.500.000₫')).toEqual(['price:1500000']);
    expect(nums('Giá 2.990.000 VND')).toEqual(['price:2990000']);
    expect(nums('Chỉ 50k thôi')).toEqual(['price:50000']);
    expect(nums('1,5 tỷ')).toEqual(['price:1500000000']);
    expect(nums('Tour 3 đêm 2 ngày')).toEqual([]);
    expect(nums('Nặng 8 kg')).toEqual([]);
    expect(nums('Ngày 1/5/2024')).toEqual([]);
    expect(nums('$50 USD')).toEqual(['price:50']);
    expect(nums('Giảm -20%')).toEqual(['percentage:-20']);
    expect(nums('1.500')).toEqual(['count:1500']);
  });

  it('keeps repeated prices and never mixes units in the headline statistics', () => {
    const html = '<html><body><p>Áo A giá $10</p><p>Áo B giá $10</p><p>Giảm 50%</p></body></html>';
    const res = parseHtmlData(html, 'https://shop.test');
    expect(res.numbers.filter(n => n.type === 'price')).toHaveLength(2);
    expect(res.numberStats.type).toBe('price');
    expect(res.numberStats.sum).toBe(20);
  });

  it('classifies JSON numbers by their own key', () => {
    const res = parseJsonData(JSON.stringify({ prices: [{ id: 7, value: 3 }], totalCount: 5, coffee: 1 }));
    const byPath = Object.fromEntries(res.numbers.map(n => [n.context, n.type]));
    expect(byPath['$.prices[0].id']).toBe('json_number');
    expect(byPath['$.totalCount']).toBe('count');
    expect(byPath['$.coffee']).toBe('json_number');
  });

  it('detects image URLs inside arrays named after images', () => {
    const res = parseJsonData(JSON.stringify({ images: ['https://cdn.test/x?id=1'], logout: '/logout' }));
    expect(res.images.map(i => i.url)).toEqual(['https://cdn.test/x?id=1']);
  });

  it('treats lookalike origins as external', () => {
    const res = parseHtmlData('<html><body><a href="https://example.com.evil.com/x">x</a><a href="/in">in</a><a href=" JavaScript:alert(1)">bad</a></body></html>', 'https://example.com');
    expect(res.links.find(l => l.url.includes('evil'))?.isExternal).toBe(true);
    expect(res.links.find(l => l.url.endsWith('/in'))?.isExternal).toBe(false);
    expect(res.links.some(l => /javascript/i.test(l.url))).toBe(false);
  });

  it('stops on zero-length regex matches', () => {
    expect(queryByRegex('bbb', 'a*')).toEqual([]);
    expect(queryByRegex('a1 a2', 'a(\\d)', 'i')).toEqual(['1', '2']);
  });

  it('computes stats for large arrays without spreading arguments', () => {
    const many = Array.from({ length: 300000 }, (_, i) => ({ value: i } as any));
    expect(computeNumberStats(many).max).toBe(299999);
  });

  it('neutralizes spreadsheet formulas in CSV output', () => {
    const csv = exportToCsvString(['a', 'b'], [['=HYPERLINK("x")', 'ok\r']]);
    expect(csv.split('\n')[1]).toBe(`"'=HYPERLINK(""x"")","ok\r"`);
  });
});

describe('table normalisation (M9)', () => {
  it('parses quoted CSV cells and does not split prose', () => {
    expect(normalizeDataToTable('city,country\n"Hà Nội, VN",Việt Nam')).toEqual([{ city: 'Hà Nội, VN', country: 'Việt Nam' }]);
    expect(normalizeDataToTable('Xin chào, đây là một câu.')).toEqual([{ 'Dòng': 1, 'Nội dung': 'Xin chào, đây là một câu.' }]);
  });
});

describe('Excel assertion round trip (M9, L8)', () => {
  it('keeps values containing semicolons', () => {
    const rules = parseAssertionsString('header[Content-Type] == "application/json; charset=utf-8"; status == 200');
    expect(rules).toEqual([
      { type: 'header', target: 'Content-Type', operator: 'eq', expected: 'application/json; charset=utf-8' },
      { type: 'status', operator: 'eq', expected: '200' }
    ]);
    expect(parseExtractVarsString('a = $.x; b = header[X-Id]').map(v => v.varName)).toEqual(['a', 'b']);
  });

  it('parses back exactly what it stringifies', () => {
    const rules: AssertionRule[] = [
      { type: 'status', operator: 'neq', expected: '500' },
      { type: 'time', operator: 'lte', expected: '300' },
      { type: 'header', target: 'X-A', operator: 'exists', expected: '' },
      { type: 'body_text', operator: 'contains', expected: 'ok; done' },
      { type: 'body_json', target: '$.data.id', operator: 'gt', expected: '10' },
      { type: 'body_json', target: '$.name', operator: 'regex', expected: '^A"b' }
    ];
    expect(parseAssertionsString(stringifyAssertions(rules))).toEqual(rules);
  });
});

describe('assertion semantics match the Go runner (H4)', () => {
  const response = { status: 201, statusText: '', body: '', headers: { 'Content-Type': 'application/json' }, responseTimeMs: 80, responseSizeByte: 0, timing: {} } as any;
  const body = { data: { id: 10, name: 'Admin', empty: null } };
  const check = (rule: Partial<AssertionRule>) => evaluateAssertion({ expected: '', ...rule } as AssertionRule, response, body, {}).passed;

  it('supports status ranges and time operators', () => {
    expect(check({ type: 'status', operator: 'eq', expected: '2xx' })).toBe(true);
    expect(check({ type: 'time', operator: 'gt', expected: '100' })).toBe(false);
    expect(check({ type: 'time', operator: 'lt', expected: '100' })).toBe(true);
  });

  it('never passes comparisons on missing values', () => {
    expect(check({ type: 'body_json', target: '$.data.price', operator: 'lt', expected: '500' })).toBe(false);
    expect(check({ type: 'body_json', target: '$.data.price', operator: 'neq', expected: 'x' })).toBe(false);
    expect(check({ type: 'body_json', target: '$.data.empty', operator: 'exists' })).toBe(true);
    expect(check({ type: 'body_json', target: '$.data.missing', operator: 'not_exists' })).toBe(true);
  });

  it('compares case-sensitively and ignores prototype properties', () => {
    expect(check({ type: 'body_json', target: '$.data.name', operator: 'eq', expected: 'admin' })).toBe(false);
    expect(getJsonPathValue({ a: 1 }, '$.constructor')).toBeUndefined();
  });

  it('renders objects as JSON when interpolated', () => {
    expect(resolveTemplateVariables('{{ obj }}', { obj: { a: 1 } })).toBe('{"a":1}');
  });
});

describe('escape stack ordering (L3)', () => {
  it('keeps a child above its parent even when the parent registers last', () => {
    escapeStack.length = 0;
    const calls: string[] = [];
    const parentOrder = nextEscapeOrder();
    const childOrder = nextEscapeOrder();
    // Child effect runs first, then the parent effect.
    const offChild = pushEscapeHandler(() => calls.push('child'), childOrder);
    const offParent = pushEscapeHandler(() => calls.push('parent'), parentOrder);
    handleEscapeKey({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    expect(calls).toEqual(['child']);
    offChild();
    offParent();
  });
});
