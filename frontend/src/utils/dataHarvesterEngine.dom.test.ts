import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { parseHtmlData, queryByCssSelector } from './dataHarvesterEngine';

// The app runs the DOMParser branch (inside the WebView). Node has no
// DOMParser, so the other test files only reach the regex fallback; happy-dom
// provides a real parser here so the branch users actually hit is covered.
const DOM_GLOBALS = ['DOMParser', 'XMLSerializer'] as const;
const globals = globalThis as Record<string, unknown>;
let window: Window;
const previous: Record<string, unknown> = {};

beforeAll(() => {
  window = new Window({ url: 'https://shop.example.com/' });
  for (const name of DOM_GLOBALS) {
    previous[name] = globals[name];
    globals[name] = (window as unknown as Record<string, unknown>)[name];
  }
});

afterAll(async () => {
  for (const name of DOM_GLOBALS) {
    if (previous[name] === undefined) delete globals[name];
    else globals[name] = previous[name];
  }
  await window.happyDOM.close();
});

const BASE_URL = 'https://shop.example.com/products';

const PAGE = `<!doctype html>
<html>
  <head>
    <title>Cửa hàng mẫu</title>
    <script>var hidden = "$999";</script>
    <style>.price { width: 100px }</style>
  </head>
  <body>
    <h2>Sản phẩm mới</h2>
    <p>Giá chỉ 150.000đ, giảm -20%</p>
    <table>
      <caption>Bảng giá</caption>
      <thead><tr><th>Tên</th><th>Giá</th></tr></thead>
      <tbody>
        <tr><td>Áo</td><td>$50</td></tr>
        <tr><td>Quần</td><td>$50</td></tr>
        <tr><td>Chi tiết</td><td><table><tr><td>inner</td><td>7</td></tr></table></td></tr>
      </tbody>
    </table>
    <a href="/cart">Giỏ hàng</a>
    <a href="https://shop.example.com.evil.com/x">Lừa đảo</a>
    <a href="javascript:alert(1)">XSS</a>
    <a href="#top">Lên đầu</a>
  </body>
</html>`;

describe('parseHtmlData with a real DOMParser', () => {
  it('uses the DOM branch, not the regex fallback', () => {
    const result = parseHtmlData(PAGE, BASE_URL);
    // The fallback labels every number "Trang web"; only the DOM walk knows
    // which element a number sits in.
    expect(result.numbers.some(n => n.context === 'Bảng #1')).toBe(true);
    expect(result.texts.find(t => t.type === 'title')?.value).toBe('Cửa hàng mẫu');
  });

  it('walks text nodes once each and skips script/style content', () => {
    const result = parseHtmlData(PAGE, BASE_URL);
    const prices = result.numbers.filter(n => n.type === 'price');

    expect(prices.map(n => n.value).sort((a, b) => a - b)).toEqual([50, 50, 150000]);
    expect(prices.filter(n => n.value === 50).every(n => n.context === 'Bảng #1')).toBe(true);
    expect(prices.find(n => n.value === 150000)?.context).toBe('Đoạn văn');
    expect(result.numbers.some(n => n.value === 999)).toBe(false);

    const pct = result.numbers.find(n => n.type === 'percentage');
    expect(pct?.value).toBe(-20);

    // A number inside the nested table belongs to that table, not the outer one.
    expect(result.numbers.find(n => n.value === 7)?.context).toBe('Bảng #2');
  });

  it('keeps nested table rows out of the outer table and does not repeat the header', () => {
    const result = parseHtmlData(PAGE, BASE_URL);
    expect(result.tables).toHaveLength(2);

    const [outer, inner] = result.tables;
    expect(outer.caption).toBe('Bảng giá');
    expect(outer.headers).toEqual(['Tên', 'Giá']);
    expect(outer.rows).toHaveLength(3);
    expect(outer.rows[0]).toEqual(['Áo', '$50']);
    expect(outer.rows.some(row => row[0] === 'Tên')).toBe(false);
    expect(outer.rows.some(row => row[0] === 'inner')).toBe(false);

    expect(inner.rows).toEqual([['inner', '7']]);
    expect(inner.headers).toEqual(['Cột 1', 'Cột 2']);
  });

  it('resolves links, compares whole origins and drops unsafe or fragment hrefs', () => {
    const result = parseHtmlData(PAGE, BASE_URL);
    expect(result.links.map(l => [l.url, l.isExternal])).toEqual([
      ['https://shop.example.com/cart', false],
      ['https://shop.example.com.evil.com/x', true]
    ]);
  });

  it('summary counts match the extracted collections', () => {
    const result = parseHtmlData(PAGE, BASE_URL);
    expect(result.summary.numberCount).toBe(result.numbers.length);
    expect(result.summary.tableCount).toBe(2);
    expect(result.summary.linkCount).toBe(2);
    expect(result.numberStatsByType.price?.count).toBe(3);
  });
});

describe('queryByCssSelector with a real DOMParser', () => {
  it('returns texts and resolved attributes for matching elements', () => {
    const result = queryByCssSelector(PAGE, 'a[href^="/"]', BASE_URL);
    expect(result.elementsCount).toBe(1);
    expect(result.texts).toEqual(['Giỏ hàng']);
    expect(result.attributes[0].href).toBe('https://shop.example.com/cart');
  });

  it('returns an empty result for an invalid selector instead of throwing', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = queryByCssSelector(PAGE, 'td[[', BASE_URL);
      expect(result).toEqual({ texts: [], attributes: [], elementsCount: 0 });
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
