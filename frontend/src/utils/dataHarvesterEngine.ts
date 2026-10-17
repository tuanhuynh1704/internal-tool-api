/**
 * Data Harvester Engine (Bộ công cụ thu thập & trích xuất dữ liệu)
 * Hỗ trợ bóc tách toàn diện Website (HTML) & API (JSON/XML/Text):
 * - Text (Văn bản, tiêu đề, đoạn văn, meta tags, links)
 * - Numbers (Số liệu, giá tiền, phần trăm, thống kê, min/max/avg/sum)
 * - Images (Hình ảnh từ img, picture, background-image, SVG, OpenGraph, JSON image URLs, Base64)
 * - Tables (Bảng dữ liệu có cấu trúc)
 * - Custom Selector (CSS Selector, JSONPath, Regex)
 */

export interface ExtractedTextItem {
  id: string;
  category: 'text';
  type: 'title' | 'heading' | 'paragraph' | 'link' | 'meta' | 'table_cell' | 'json_string' | 'custom';
  label: string;
  value: string;
  context: string;
  length: number;
}

export interface ExtractedNumberItem {
  id: string;
  category: 'number';
  type: 'price' | 'percentage' | 'rating' | 'phone' | 'json_number' | 'count' | 'generic';
  label: string;
  value: number;
  rawText: string;
  context: string;
}

export interface ExtractedImageItem {
  id: string;
  category: 'image';
  type: 'img_tag' | 'picture' | 'background' | 'og_image' | 'svg' | 'favicon' | 'json_image_url' | 'base64';
  url: string;
  alt: string;
  format: string;
  source: string;
  width?: number;
  height?: number;
}

export interface ExtractedLinkItem {
  id: string;
  text: string;
  url: string;
  isExternal: boolean;
  context: string;
}

export interface ExtractedTableData {
  id: string;
  caption?: string;
  headers: string[];
  rows: string[][];
}

export interface NumberStats {
  count: number;
  min: number;
  max: number;
  sum: number;
  avg: number;
  /** Which number type these statistics describe (they never mix units). */
  type?: ExtractedNumberItem['type'];
}

export interface HarvesterResult {
  isHtml: boolean;
  isJson: boolean;
  texts: ExtractedTextItem[];
  numbers: ExtractedNumberItem[];
  images: ExtractedImageItem[];
  links: ExtractedLinkItem[];
  tables: ExtractedTableData[];
  numberStats: NumberStats;
  /** Statistics per number type (prices, percentages, ratings...). */
  numberStatsByType: Partial<Record<ExtractedNumberItem['type'], NumberStats>>;
  summary: {
    totalItems: number;
    textCount: number;
    numberCount: number;
    imageCount: number;
    linkCount: number;
    tableCount: number;
  };
}

// Helper to compute number stats (single pass, no argument spreading)
export function computeNumberStats(numbers: ExtractedNumberItem[]): NumberStats {
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const n of numbers) {
    const v = n.value;
    if (!Number.isFinite(v)) continue;
    count++;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  if (count === 0) {
    return { count: 0, min: 0, max: 0, sum: 0, avg: 0 };
  }
  return {
    count,
    min,
    max,
    sum: Math.round(sum * 100) / 100,
    avg: Math.round((sum / count) * 100) / 100
  };
}

/**
 * Statistics per number type plus a headline set. Mixing prices, ratings,
 * percentages, IDs and timestamps in one min/max/avg is meaningless, so the
 * headline uses prices when there are any, otherwise the most frequent type.
 */
export function summarizeNumbers(numbers: ExtractedNumberItem[]): {
  numberStats: NumberStats;
  numberStatsByType: Partial<Record<ExtractedNumberItem['type'], NumberStats>>;
} {
  const groups = new Map<ExtractedNumberItem['type'], ExtractedNumberItem[]>();
  for (const n of numbers) {
    const list = groups.get(n.type) || [];
    list.push(n);
    groups.set(n.type, list);
  }
  const numberStatsByType: Partial<Record<ExtractedNumberItem['type'], NumberStats>> = {};
  groups.forEach((list, type) => {
    numberStatsByType[type] = { ...computeNumberStats(list), type };
  });
  let primary: ExtractedNumberItem['type'] | undefined = groups.has('price') ? 'price' : undefined;
  if (!primary) {
    let best = 0;
    groups.forEach((list, type) => {
      if (list.length > best) {
        best = list.length;
        primary = type;
      }
    });
  }
  const numberStats = primary && numberStatsByType[primary]
    ? numberStatsByType[primary]!
    : { count: 0, min: 0, max: 0, sum: 0, avg: 0 };
  return { numberStats, numberStatsByType };
}

/** Origin of a URL, or '' when it cannot be parsed. */
function originOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function isExternalLink(fullUrl: string, baseOrigin: string): boolean {
  if (!baseOrigin) return false;
  const origin = originOf(fullUrl);
  // Compare whole origins: "https://example.com.evil.com" starts with
  // "https://example.com" but is a different site.
  return origin !== '' && origin !== baseOrigin;
}

const UNSAFE_HREF = /^\s*(javascript|vbscript|data):/i;

/** Splits "logoUrl" / "thumbnail_image" into lowercase words. */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const IMAGE_KEY_WORDS = new Set(['image', 'images', 'img', 'imgs', 'avatar', 'avatars', 'photo', 'photos', 'picture', 'pictures', 'pic', 'thumb', 'thumbs', 'thumbnail', 'thumbnails', 'logo', 'logos', 'banner', 'banners', 'icon', 'icons', 'cover', 'poster', 'graphic', 'illustration', 'favicon']);

function classifyJsonNumber(key: string): ExtractedNumberItem['type'] {
  const words = new Set(keyWords(key));
  const has = (...list: string[]) => list.some(w => words.has(w));
  // Counts are checked first so "totalCount" / "totalPages" are not prices.
  if (has('count', 'qty', 'quantity', 'stock', 'pages', 'items', 'num', 'number')) return 'count';
  if (has('price', 'prices', 'cost', 'amount', 'fee', 'fees', 'subtotal', 'total', 'tax', 'discount')) return 'price';
  if (has('rating', 'ratings', 'score', 'stars')) return 'rating';
  if (has('percent', 'percentage', 'pct', 'ratio', 'rate')) return 'percentage';
  return 'json_number';
}

// Resolve relative URL safely
export function resolveUrl(relativeOrAbsolute: string, baseUrl?: string): string {
  if (!relativeOrAbsolute || typeof relativeOrAbsolute !== 'string') return '';
  const trimmed = relativeOrAbsolute.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) {
    return trimmed;
  }
  if (!baseUrl) {
    if (trimmed.startsWith('//')) return 'https:' + trimmed;
    return trimmed;
  }
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    if (trimmed.startsWith('//')) return 'https:' + trimmed;
    return trimmed;
  }
}

// Detect image format from URL or data URI
export function detectImageFormat(url: string): string {
  if (!url) return 'unknown';
  if (url.startsWith('data:image/svg')) return 'svg';
  if (url.startsWith('data:image/png')) return 'png';
  if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg')) return 'jpg';
  if (url.startsWith('data:image/webp')) return 'webp';
  if (url.startsWith('data:image/gif')) return 'gif';
  if (url.startsWith('data:image/')) return 'base64';

  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'jpg';
  if (clean.endsWith('.webp')) return 'webp';
  if (clean.endsWith('.svg')) return 'svg';
  if (clean.endsWith('.gif')) return 'gif';
  if (clean.endsWith('.avif')) return 'avif';
  if (clean.endsWith('.bmp')) return 'bmp';
  if (clean.endsWith('.ico')) return 'ico';
  return 'image';
}

// Check if string looks like an image URL
export function isLikelyImageUrl(val: string): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.startsWith('data:image/')) return true;
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('//') && !trimmed.startsWith('/')) {
    return false;
  }
  const clean = trimmed.split('?')[0].split('#')[0].toLowerCase();
  return /\.(png|jpe?g|webp|svg|gif|avif|bmp|ico)$/i.test(clean);
}

/**
 * Trích xuất tên file sạch và giải mã từ URL hình ảnh
 */
export function extractFilenameFromUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:')) {
    const fmt = detectImageFormat(trimmed);
    return `image_base64.${fmt}`;
  }
  try {
    const cleanUrl = trimmed.split('?')[0].split('#')[0];
    const parts = cleanUrl.split('/').filter(Boolean);
    const lastPart = parts.pop();
    if (lastPart) {
      const decoded = decodeURIComponent(lastPart);
      if (decoded.length > 0 && decoded !== '.' && !decoded.startsWith('.')) {
        return decoded;
      }
    }
  } catch {
    const last = trimmed.split('/').pop()?.split(/[?#]/)[0];
    if (last && last.length > 0) return last;
  }
  return '';
}

/**
 * Trích xuất tên/tiêu đề mô tả phù hợp nhất cho ảnh từ context JSON
 */
export function extractDescriptiveImageName(
  url: string,
  key: string,
  parent: any,
  grandParent?: any
): string {
  const candidateKeys = [
    'title', 'name', 'product_name', 'productname', 'product_title', 'producttitle',
    'item_name', 'itemname', 'caption', 'alt', 'alt_text', 'alttext', 'label',
    'heading', 'subject', 'description', 'desc', 'slug'
  ];

  const findInObj = (obj: any): string | null => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    for (const cand of candidateKeys) {
      for (const k of Object.keys(obj)) {
        if (k.toLowerCase() === cand) {
          const val = obj[k];
          if (typeof val === 'string') {
            const clean = val.trim();
            if (clean.length > 0 && !clean.startsWith('http://') && !clean.startsWith('https://') && !clean.startsWith('data:')) {
              if (clean.length <= 120) return clean;
              return clean.substring(0, 117) + '...';
            }
          }
        }
      }
    }
    return null;
  };

  // 1. Thử tìm trong parent object (ví dụ sản phẩm { title: "CeraVe", image: "..." })
  const fromParent = findInObj(parent);
  if (fromParent) return fromParent;

  // 2. Thử tìm trong grandParent object (khi parent là array, vd: { title: "...", images: ["url1", "url2"] })
  const fromGrandParent = findInObj(grandParent);
  if (fromGrandParent) return fromGrandParent;

  // 3. Lấy tên file gốc từ URL
  const fileFromUrl = extractFilenameFromUrl(url);
  if (fileFromUrl) {
    return fileFromUrl;
  }

  // 4. Nếu key của field có ý nghĩa (vd: avatar, logo, thumbnail, banner...)
  if (key && !key.match(/^\d+$/) && !key.startsWith('$')) {
    const formattedKey = key
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, c => c.toUpperCase());
    return formattedKey;
  }

  return 'Ảnh trích xuất';
}


// A number with optional thousands groups and decimals: 1.500.000 | 32,990,000 | 1,099.00 | 1,5 | 49.50
const NUM = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?`;
const CURRENCY_PREFIX = String.raw`[$€£¥₫]|VND|USD|EUR|GBP|JPY`;
// Units are only accepted when not followed by another letter, so "3 đêm",
// "8 kg" or "5 km" are not read as prices.
const CURRENCY_SUFFIX = String.raw`₫|VNĐ|VND|USD|EUR|GBP|JPY|đồng|đ|\$|€|nghìn|ngàn|triệu|tr|tỷ|tỉ|k`;
const PRICE_REGEX_PREFIX = new RegExp(String.raw`(?<![\p{L}\d])(?:${CURRENCY_PREFIX})\s*(${NUM})(?![\d])`, 'giu');
const PRICE_REGEX_SUFFIX = new RegExp(String.raw`(?<![\p{L}\d.,])(${NUM})\s*(${CURRENCY_SUFFIX})(?![\p{L}\d])`, 'giu');
const PERCENTAGE_REGEX = new RegExp(String.raw`(?<![\p{L}\d.,])([+\-−]?(?:${NUM}))\s*%`, 'gu');
// "4.9/5", "4 out of 5", "4,5 trên 5" — but not dates such as 1/5/2024 or 10/5.
const RATING_REGEX = new RegExp(String.raw`(?<![\d/.,])([0-5](?:[.,]\d+)?)\s*(?:\/\s*5|out of 5|trên 5)(?![\d/.,])`, 'giu');
const STANDALONE_NUMBER = new RegExp(String.raw`^[+\-−]?(?:${NUM})$`, 'u');

const MULTIPLIERS: Record<string, number> = { k: 1e3, nghìn: 1e3, ngàn: 1e3, tr: 1e6, 'triệu': 1e6, 'tỷ': 1e9, 'tỉ': 1e9 };

/**
 * Parses a localized number. Vietnamese and most European formats use "." for
 * thousands and "," for decimals, English uses the opposite:
 *  - both separators present → the last one is the decimal separator;
 *  - a separator repeated (1.500.000) → thousands;
 *  - a single separator followed by exactly three digits (1.500 / 1,500) → thousands;
 *  - otherwise it is the decimal separator (1,5 / 49.50).
 */
export function parseLocalizedNumber(raw: string): number {
  let text = raw.trim().replace(/\s+/g, '').replace('−', '-');
  const sign = text.startsWith('-') ? -1 : 1;
  text = text.replace(/^[+-]/, '');
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let normalized: string;
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    normalized = text.split(thousands).join('').replace(decimal, '.');
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ',';
    const parts = text.split(sep);
    const isThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0');
    normalized = isThousands ? parts.join('') : parts.join('.');
  } else {
    normalized = text;
  }
  const value = parseFloat(normalized);
  return Number.isNaN(value) ? NaN : sign * value;
}

/**
 * Extract numbers from free text
 */
export function extractNumbersFromText(text: string, contextLabel: string): ExtractedNumberItem[] {
  const result: ExtractedNumberItem[] = [];
  if (!text || typeof text !== 'string') return result;

  // Character ranges already attributed to a number, so "$50 USD" is one
  // price and a price is not reported again as a plain count.
  const taken: Array<[number, number]> = [];
  const overlaps = (start: number, end: number) => taken.some(([s, e]) => start < e && end > s);
  const add = (match: RegExpExecArray, type: ExtractedNumberItem['type'], label: string, value: number) => {
    const start = match.index;
    const end = start + match[0].length;
    if (Number.isNaN(value) || overlaps(start, end)) return;
    taken.push([start, end]);
    result.push({
      id: Math.random().toString(36).substring(2, 9),
      category: 'number',
      type,
      label: `${label} (${contextLabel})`,
      value,
      rawText: match[0].trim(),
      context: contextLabel
    });
  };

  let match: RegExpExecArray | null;

  // 1. Detect Prices
  const pRegex = new RegExp(PRICE_REGEX_PREFIX);
  while ((match = pRegex.exec(text)) !== null) {
    add(match, 'price', 'Giá tiền', parseLocalizedNumber(match[1]));
  }

  const pSuffixRegex = new RegExp(PRICE_REGEX_SUFFIX);
  while ((match = pSuffixRegex.exec(text)) !== null) {
    const unit = match[2].toLowerCase();
    add(match, 'price', 'Giá tiền', parseLocalizedNumber(match[1]) * (MULTIPLIERS[unit] ?? 1));
  }

  // 2. Detect Percentages (the sign is kept: "-20%" is a negative change)
  const pctRegex = new RegExp(PERCENTAGE_REGEX);
  while ((match = pctRegex.exec(text)) !== null) {
    add(match, 'percentage', 'Phần trăm', parseLocalizedNumber(match[1]));
  }

  // 3. Detect Ratings
  const rateRegex = new RegExp(RATING_REGEX);
  while ((match = rateRegex.exec(text)) !== null) {
    add(match, 'rating', 'Đánh giá', parseLocalizedNumber(match[1]));
  }

  // 4. Standalone numbers if text is short (e.g. badge count or statistic: "42", "1,500", "1.500")
  const trimmed = text.trim();
  if (result.length === 0 && STANDALONE_NUMBER.test(trimmed)) {
    const num = parseLocalizedNumber(trimmed);
    if (!Number.isNaN(num)) {
      result.push({
        id: Math.random().toString(36).substring(2, 9),
        category: 'number',
        type: 'count',
        label: `Chỉ số đếm (${contextLabel})`,
        value: num,
        rawText: trimmed,
        context: contextLabel
      });
    }
  }

  return result;
}

/**
 * Fallback regex-based parser when DOMParser is unavailable (e.g., in Node / Vitest)
 */
function parseHtmlWithRegexFallback(html: string, baseUrl?: string): HarvesterResult {
  const texts: ExtractedTextItem[] = [];
  const numbers: ExtractedNumberItem[] = [];
  const images: ExtractedImageItem[] = [];
  const links: ExtractedLinkItem[] = [];
  const tables: ExtractedTableData[] = [];
  const seenImageUrls = new Set<string>();

  // Title
  const titleMatch = /<title[^>]*>(.*?)<\/title>/is.exec(html);
  if (titleMatch && titleMatch[1].trim()) {
    texts.push({
      id: Math.random().toString(36).substring(2, 9),
      category: 'text',
      type: 'title',
      label: 'Tiêu đề trang (Title)',
      value: titleMatch[1].trim(),
      context: '<title>',
      length: titleMatch[1].trim().length
    });
  }

  // Meta Description
  const metaDescMatch = /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i.exec(html) ||
    /<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i.exec(html);
  if (metaDescMatch && metaDescMatch[1].trim()) {
    texts.push({
      id: Math.random().toString(36).substring(2, 9),
      category: 'text',
      type: 'meta',
      label: 'Meta Description',
      value: metaDescMatch[1].trim(),
      context: 'meta[name="description"]',
      length: metaDescMatch[1].trim().length
    });
  }

  // OG Title & OG Image
  const ogTitleMatch = /<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i.exec(html);
  if (ogTitleMatch && ogTitleMatch[1].trim()) {
    texts.push({
      id: Math.random().toString(36).substring(2, 9),
      category: 'text',
      type: 'meta',
      label: 'OpenGraph Title',
      value: ogTitleMatch[1].trim(),
      context: 'og:title',
      length: ogTitleMatch[1].trim().length
    });
  }

  const ogImgMatch = /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i.exec(html);
  if (ogImgMatch && ogImgMatch[1].trim()) {
    const fullUrl = resolveUrl(ogImgMatch[1].trim(), baseUrl);
    const ogTitle = ogTitleMatch?.[1]?.trim();
    const fileFromUrl = extractFilenameFromUrl(fullUrl);
    images.push({
      id: Math.random().toString(36).substring(2, 9),
      category: 'image',
      type: 'og_image',
      url: fullUrl,
      alt: ogTitle || fileFromUrl || 'OpenGraph Social Share Image',
      format: detectImageFormat(fullUrl),
      source: 'meta[property="og:image"]'
    });
    seenImageUrls.add(fullUrl);
  }

  // Headings h1-h6
  const hRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gis;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = hRegex.exec(html)) !== null) {
    const level = hMatch[1];
    const text = hMatch[2].replace(/<[^>]+>/g, '').trim();
    if (text) {
      texts.push({
        id: Math.random().toString(36).substring(2, 9),
        category: 'text',
        type: 'heading',
        label: `Tiêu đề H${level}`,
        value: text,
        context: `<h${level}>`,
        length: text.length
      });
    }
  }

  // Paragraphs
  const pRegex = /<p[^>]*>(.*?)<\/p>/gis;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(html)) !== null) {
    const text = pMatch[1].replace(/<[^>]+>/g, '').trim();
    if (text && text.length > 5) {
      texts.push({
        id: Math.random().toString(36).substring(2, 9),
        category: 'text',
        type: 'paragraph',
        label: 'Đoạn văn',
        value: text,
        context: '<p>',
        length: text.length
      });
    }
  }

  // Images <img>
  const imgRegex = /<img\s+([^>]+)>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const attrs = imgMatch[1];
    const srcMatch = /src=["']([^"']+)["']/i.exec(attrs);
    if (srcMatch && srcMatch[1]) {
      const fullUrl = resolveUrl(srcMatch[1], baseUrl);
      if (!seenImageUrls.has(fullUrl)) {
        seenImageUrls.add(fullUrl);
        const altMatch = /alt=["']([^"']*)["']/i.exec(attrs);
        const titleMatch = /title=["']([^"']*)["']/i.exec(attrs);
        const fileFromUrl = extractFilenameFromUrl(fullUrl);
        images.push({
          id: Math.random().toString(36).substring(2, 9),
          category: 'image',
          type: 'img_tag',
          url: fullUrl,
          alt: altMatch?.[1]?.trim() || titleMatch?.[1]?.trim() || fileFromUrl || 'Ảnh trang web',
          format: detectImageFormat(fullUrl),
          source: '<img src="...">',
          width: undefined,
          height: undefined
        });
      }
    }
  }

  // Background images
  const bgRegex = /background-image:\s*url\(['"]?(.*?)['"]?\)/gi;
  let bgMatch: RegExpExecArray | null;
  while ((bgMatch = bgRegex.exec(html)) !== null) {
    if (bgMatch[1]) {
      const fullUrl = resolveUrl(bgMatch[1], baseUrl);
      if (!seenImageUrls.has(fullUrl)) {
        seenImageUrls.add(fullUrl);
        const fileFromUrl = extractFilenameFromUrl(fullUrl);
        images.push({
          id: Math.random().toString(36).substring(2, 9),
          category: 'image',
          type: 'background',
          url: fullUrl,
          alt: fileFromUrl ? `Background: ${fileFromUrl}` : 'Background image',
          format: detectImageFormat(fullUrl),
          source: 'style="background-image:..."'
        });
      }
    }
  }

  // Links <a>
  const aRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  let aMatch: RegExpExecArray | null;
  const seenLinks = new Set<string>();
  const fallbackOrigin = originOf(baseUrl);
  while ((aMatch = aRegex.exec(html)) !== null) {
    const rawHref = aMatch[1].trim();
    if (rawHref && !rawHref.startsWith('#') && !UNSAFE_HREF.test(rawHref)) {
      const fullUrl = resolveUrl(rawHref, baseUrl);
      if (!seenLinks.has(fullUrl)) {
        seenLinks.add(fullUrl);
        const text = aMatch[2].replace(/<[^>]+>/g, '').trim() || fullUrl;
        links.push({
          id: Math.random().toString(36).substring(2, 9),
          text,
          url: fullUrl,
          isExternal: isExternalLink(fullUrl, fallbackOrigin),
          context: '<a>'
        });
      }
    }
  }

  // Tables <table>
  const tableRegex = /<table[^>]*>(.*?)<\/table>/gis;
  let tMatch: RegExpExecArray | null;
  let tableIdx = 1;
  while ((tMatch = tableRegex.exec(html)) !== null) {
    const tableBody = tMatch[1];
    const captionMatch = /<caption[^>]*>(.*?)<\/caption>/is.exec(tableBody);
    const headers: string[] = [];
    const thRegex = /<th[^>]*>(.*?)<\/th>/gis;
    let thMatch: RegExpExecArray | null;
    while ((thMatch = thRegex.exec(tableBody)) !== null) {
      headers.push(thMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    const rows: string[][] = [];
    const trRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trRegex.exec(tableBody)) !== null) {
      const trContent = trMatch[1];
      const cells: string[] = [];
      const tdRegex = /<td[^>]*>(.*?)<\/td>/gis;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRegex.exec(trContent)) !== null) {
        const cText = tdMatch[1].replace(/<[^>]+>/g, '').trim();
        cells.push(cText);
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (headers.length > 0 || rows.length > 0) {
      tables.push({
        id: `tbl_${tableIdx}`,
        caption: captionMatch ? captionMatch[1].trim() : `Bảng dữ liệu #${tableIdx}`,
        headers,
        rows
      });
      tableIdx++;
    }
  }

  // Extract numbers once from the visible text: every occurrence counts once,
  // so two products with the same price are both kept.
  const strippedText = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n');
  strippedText.split('\n').forEach(chunk => {
    if (chunk.trim()) numbers.push(...extractNumbersFromText(chunk, 'Trang web'));
  });
  const uniqueNumbers = numbers;

  const { numberStats, numberStatsByType } = summarizeNumbers(uniqueNumbers);

  return {
    isHtml: true,
    isJson: false,
    texts,
    numbers: uniqueNumbers,
    images,
    links,
    tables,
    numberStats,
    numberStatsByType,
    summary: {
      totalItems: texts.length + uniqueNumbers.length + images.length + links.length + tables.length,
      textCount: texts.length,
      numberCount: uniqueNumbers.length,
      imageCount: images.length,
      linkCount: links.length,
      tableCount: tables.length
    }
  };
}

/**
 * PARSER CHO TOÀN BỘ TRANG WEB (HTML Webpage Harvester)
 */
export function parseHtmlData(html: string, baseUrl?: string): HarvesterResult {
  const texts: ExtractedTextItem[] = [];
  const numbers: ExtractedNumberItem[] = [];
  const images: ExtractedImageItem[] = [];
  const links: ExtractedLinkItem[] = [];
  const tables: ExtractedTableData[] = [];

  if (!html || typeof html !== 'string') {
    return {
      isHtml: true,
      isJson: false,
      texts,
      numbers,
      images,
      links,
      tables,
      numberStats: computeNumberStats(numbers),
      numberStatsByType: {},
      summary: { totalItems: 0, textCount: 0, numberCount: 0, imageCount: 0, linkCount: 0, tableCount: 0 }
    };
  }

  // Check if browser DOMParser is available
  if (typeof DOMParser === 'undefined') {
    return parseHtmlWithRegexFallback(html, baseUrl);
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 1. Thu thập Metadata & Title
    const titleEl = doc.querySelector('title');
    if (titleEl && titleEl.textContent?.trim()) {
      texts.push({
        id: Math.random().toString(36).substring(2, 9),
        category: 'text',
        type: 'title',
        label: 'Tiêu đề trang (Title)',
        value: titleEl.textContent.trim(),
        context: '<title>',
        length: titleEl.textContent.trim().length
      });
    }

    // Meta Description & Keywords & OpenGraph
    const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content');
    if (metaDesc) {
      texts.push({
        id: Math.random().toString(36).substring(2, 9),
        category: 'text',
        type: 'meta',
        label: 'Meta Description',
        value: metaDesc.trim(),
        context: 'meta[name="description"]',
        length: metaDesc.trim().length
      });
    }

    const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
    if (ogTitle && ogTitle !== titleEl?.textContent?.trim()) {
      texts.push({
        id: Math.random().toString(36).substring(2, 9),
        category: 'text',
        type: 'meta',
        label: 'OpenGraph Title',
        value: ogTitle.trim(),
        context: 'og:title',
        length: ogTitle.trim().length
      });
    }

    const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
    if (ogDesc && ogDesc !== metaDesc) {
      texts.push({
        id: Math.random().toString(36).substring(2, 9),
        category: 'text',
        type: 'meta',
        label: 'OpenGraph Description',
        value: ogDesc.trim(),
        context: 'og:description',
        length: ogDesc.trim().length
      });
    }

    // OpenGraph & Twitter Images
    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
    if (ogImage) {
      const fullUrl = resolveUrl(ogImage, baseUrl);
      const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
      const fileFromUrl = extractFilenameFromUrl(fullUrl);
      images.push({
        id: Math.random().toString(36).substring(2, 9),
        category: 'image',
        type: 'og_image',
        url: fullUrl,
        alt: ogTitle || fileFromUrl || 'OpenGraph Social Share Image',
        format: detectImageFormat(fullUrl),
        source: 'meta[property="og:image"]'
      });
    }

    // Favicon
    const faviconEl = doc.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
    if (faviconEl) {
      const favHref = faviconEl.getAttribute('href');
      if (favHref) {
        const fullUrl = resolveUrl(favHref, baseUrl);
        const fileFromUrl = extractFilenameFromUrl(fullUrl);
        images.push({
          id: Math.random().toString(36).substring(2, 9),
          category: 'image',
          type: 'favicon',
          url: fullUrl,
          alt: fileFromUrl ? `Favicon (${fileFromUrl})` : 'Website Favicon / Icon',
          format: detectImageFormat(fullUrl),
          source: 'link[rel="icon"]'
        });
      }
    }

    // 2. Thu thập Headings (h1 - h6)
    const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(h => {
      const text = h.textContent?.trim();
      if (text) {
        const tagName = h.tagName.toUpperCase();
        texts.push({
          id: Math.random().toString(36).substring(2, 9),
          category: 'text',
          type: 'heading',
          label: `Tiêu đề ${tagName}`,
          value: text,
          context: `<${tagName.toLowerCase()}>`,
          length: text.length
        });
      }
    });

    // 3. Thu thập Đoạn văn (p, blockquote, article)
    const paragraphs = doc.querySelectorAll('p, blockquote');
    paragraphs.forEach(p => {
      const text = p.textContent?.trim();
      if (text && text.length > 5) {
        texts.push({
          id: Math.random().toString(36).substring(2, 9),
          category: 'text',
          type: 'paragraph',
          label: 'Đoạn văn',
          value: text,
          context: '<p>',
          length: text.length
        });
      }
    });

    // 4. Thu thập Hình ảnh (img, picture, source)
    const imgElements = doc.querySelectorAll('img');
    const seenImageUrls = new Set<string>();
    imgElements.forEach(img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
      if (src) {
        const fullUrl = resolveUrl(src, baseUrl);
        if (fullUrl && !seenImageUrls.has(fullUrl)) {
          seenImageUrls.add(fullUrl);
          const alt = img.getAttribute('alt')?.trim();
          const title = img.getAttribute('title')?.trim();
          const fileFromUrl = extractFilenameFromUrl(fullUrl);
          const w = parseInt(img.getAttribute('width') || '0', 10) || undefined;
          const h = parseInt(img.getAttribute('height') || '0', 10) || undefined;
          images.push({
            id: Math.random().toString(36).substring(2, 9),
            category: 'image',
            type: 'img_tag',
            url: fullUrl,
            alt: alt || title || fileFromUrl || 'Ảnh trang web',
            format: detectImageFormat(fullUrl),
            source: `<img src="${src.length > 40 ? src.substring(0, 37) + '...' : src}">`,
            width: w,
            height: h
          });
        }
      }
    });

    // Background images in inline styles
    const allElsWithStyle = doc.querySelectorAll('[style*="background"]');
    allElsWithStyle.forEach(el => {
      const style = el.getAttribute('style') || '';
      const bgMatch = /url\(['"]?(.*?)['"]?\)/i.exec(style);
      if (bgMatch && bgMatch[1]) {
        const fullUrl = resolveUrl(bgMatch[1], baseUrl);
        if (fullUrl && !seenImageUrls.has(fullUrl) && !fullUrl.startsWith('data:image/svg+xml;utf8,')) {
          seenImageUrls.add(fullUrl);
          const fileFromUrl = extractFilenameFromUrl(fullUrl);
          images.push({
            id: Math.random().toString(36).substring(2, 9),
            category: 'image',
            type: 'background',
            url: fullUrl,
            alt: fileFromUrl ? `Background: ${fileFromUrl}` : 'Background image',
            format: detectImageFormat(fullUrl),
            source: 'style="background-image:..."'
          });
        }
      }
    });

    // Inline SVG graphics
    const svgs = doc.querySelectorAll('svg');
    if (svgs.length > 0) {
      let count = 0;
      svgs.forEach(svg => {
        if (count >= 15) return; // Limit SVGs to 15 to prevent memory overflow
        try {
          const svgString = new XMLSerializer().serializeToString(svg);
          if (svgString && svgString.length > 50 && svgString.length < 50000) {
            const encodedSvg = `data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`;
            if (!seenImageUrls.has(encodedSvg)) {
              seenImageUrls.add(encodedSvg);
              count++;
              images.push({
                id: Math.random().toString(36).substring(2, 9),
                category: 'image',
                type: 'svg',
                url: encodedSvg,
                alt: 'Vector SVG Icon',
                format: 'svg',
                source: '<svg>'
              });
            }
          }
        } catch {
          // ignore serialize errors
        }
      });
    }

    // 5. Thu thập Liên kết (a tags)
    const anchorEls = doc.querySelectorAll('a[href]');
    const seenLinks = new Set<string>();
    const baseOrigin = originOf(baseUrl);
    anchorEls.forEach(a => {
      const rawHref = (a.getAttribute('href') || '').trim();
      if (rawHref && !rawHref.startsWith('#') && !UNSAFE_HREF.test(rawHref)) {
        const fullUrl = resolveUrl(rawHref, baseUrl);
        if (fullUrl && !seenLinks.has(fullUrl)) {
          seenLinks.add(fullUrl);
          const linkText = a.textContent?.trim() || a.getAttribute('title') || fullUrl;
          const isExternal = isExternalLink(fullUrl, baseOrigin);
          links.push({
            id: Math.random().toString(36).substring(2, 9),
            text: linkText,
            url: fullUrl,
            isExternal,
            context: '<a>'
          });
        }
      }
    });

    // 6. Thu thập Bảng biểu (Tables)
    const tableEls = doc.querySelectorAll('table');
    tableEls.forEach((table, tIdx) => {
      const caption = table.querySelector(':scope > caption')?.textContent?.trim();
      // table.rows only contains this table's own rows (never a nested table's),
      // and the header row is taken out of the data rows instead of repeated.
      // closest() filters guard against DOM implementations whose rows/cells
      // collections also include a nested table's elements.
      const allRows = Array.from((table as HTMLTableElement).rows || []).filter(tr => tr.closest('table') === table);
      const ownCells = (tr: HTMLTableRowElement) => Array.from(tr.cells).filter(cell => cell.closest('tr') === tr);
      const cellsOf = (tr: HTMLTableRowElement) => ownCells(tr).map(cell => cell.textContent?.trim() || '');
      let headerRow: HTMLTableRowElement | undefined = allRows.find(tr => tr.parentElement?.tagName === 'THEAD');
      if (!headerRow && allRows[0] && ownCells(allRows[0]).length > 0 && ownCells(allRows[0]).every(c => c.tagName === 'TH')) {
        headerRow = allRows[0];
      }
      const headers: string[] = headerRow ? cellsOf(headerRow).map((h, idx) => h || `Cột ${idx + 1}`) : [];

      const rows: string[][] = [];
      allRows.forEach(tr => {
        if (tr === headerRow || tr.parentElement?.tagName === 'THEAD') return;
        const cells = cellsOf(tr);
        if (cells.length > 0) {
          rows.push(cells);
        }
      });

      if (rows.length > 0 || headers.length > 0) {
        tables.push({
          id: `tbl_${tIdx + 1}`,
          caption: caption || `Bảng dữ liệu #${tIdx + 1}`,
          headers: headers.length > 0 ? headers : (rows[0] ? rows[0].map((_, i) => `Cột ${i + 1}`) : []),
          rows
        });
      }
    });

    // Numbers: one pass over the visible text nodes, so each occurrence is
    // counted exactly once (a price inside <p> inside <td> is not doubled) and
    // repeated legitimate values (two items at the same price) are all kept.
    const contextOf = (node: Node): string => {
      let el = node.parentElement;
      while (el) {
        const tag = el.tagName;
        if (/^H[1-6]$/.test(tag)) return tag;
        if (tag === 'TABLE') return `Bảng #${Array.from(tableEls).indexOf(el as HTMLTableElement) + 1}`;
        if (tag === 'P' || tag === 'BLOCKQUOTE') return 'Đoạn văn';
        el = el.parentElement;
      }
      return 'Trang web';
    };
    const root = doc.body || doc.documentElement;
    if (root) {
      // Iterative depth-first walk in document order (no TreeWalker: some DOM
      // implementations return nothing for parsed documents).
      const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
      const stack: Node[] = [root];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.nodeType === 3 /* TEXT_NODE */) {
          const value = node.nodeValue || '';
          if (value.trim()) numbers.push(...extractNumbersFromText(value, contextOf(node)));
          continue;
        }
        if (node.nodeType === 1 && skipTags.has((node as Element).tagName)) continue;
        const children = node.childNodes;
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
    }
    const uniqueNumbers = numbers;

    const { numberStats, numberStatsByType } = summarizeNumbers(uniqueNumbers);

    return {
      isHtml: true,
      isJson: false,
      texts,
      numbers: uniqueNumbers,
      images,
      links,
      tables,
      numberStats,
      numberStatsByType,
      summary: {
        totalItems: texts.length + uniqueNumbers.length + images.length + links.length + tables.length,
        textCount: texts.length,
        numberCount: uniqueNumbers.length,
        imageCount: images.length,
        linkCount: links.length,
        tableCount: tables.length
      }
    };
  } catch {
    return parseHtmlWithRegexFallback(html, baseUrl);
  }
}

/**
 * PARSER CHO API TRẢ VỀ (JSON Data Harvester)
 */
export function parseJsonData(jsonStr: string): HarvesterResult {
  const texts: ExtractedTextItem[] = [];
  const numbers: ExtractedNumberItem[] = [];
  const images: ExtractedImageItem[] = [];
  const links: ExtractedLinkItem[] = [];
  const tables: ExtractedTableData[] = [];

  try {
    const data = JSON.parse(jsonStr);

    const seenImages = new Set<string>();
    const seenLinks = new Set<string>();

    const walk = (node: any, currentPath: string, parent?: any, grandParent?: any, currentKey?: string, parentKey?: string) => {
      if (node === null || node === undefined) return;
      // Array elements are named after their array ("images[0]" → "images").
      const semanticKey = currentKey && /^\d+$/.test(currentKey) ? (parentKey || '') : (currentKey || '');

      if (typeof node === 'string') {
        const trimmed = node.trim();
        // Check if string is an image (whole words of the key: "logoUrl" yes, "logout" no)
        const isImageByName = keyWords(semanticKey).some(w => IMAGE_KEY_WORDS.has(w));
        const isImageByVal = isLikelyImageUrl(trimmed);

        if ((isImageByName || isImageByVal) && (trimmed.startsWith('http') || trimmed.startsWith('data:image/') || trimmed.startsWith('/'))) {
          if (!seenImages.has(trimmed)) {
            seenImages.add(trimmed);
            const descriptiveName = extractDescriptiveImageName(trimmed, currentKey || '', parent, grandParent);
            images.push({
              id: Math.random().toString(36).substring(2, 9),
              category: 'image',
              type: 'json_image_url',
              url: trimmed,
              alt: descriptiveName,
              format: detectImageFormat(trimmed),
              source: currentPath
            });
          }
        } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          if (!seenLinks.has(trimmed)) {
            seenLinks.add(trimmed);
            links.push({
              id: Math.random().toString(36).substring(2, 9),
              text: currentPath,
              url: trimmed,
              isExternal: true,
              context: currentPath
            });
          }
        } else if (trimmed.length > 0) {
          texts.push({
            id: Math.random().toString(36).substring(2, 9),
            category: 'text',
            type: 'json_string',
            label: currentPath,
            value: trimmed,
            context: currentPath,
            length: trimmed.length
          });
          // Also check if string contains currency or percentages
          numbers.push(...extractNumbersFromText(trimmed, currentPath));
        }
      } else if (typeof node === 'number') {
        // Classified by the field's own name, not by every ancestor in the
        // path: "$.prices[0].id" is an id, not a price.
        const type = classifyJsonNumber(semanticKey);

        numbers.push({
          id: Math.random().toString(36).substring(2, 9),
          category: 'number',
          type,
          label: currentPath,
          value: node,
          rawText: String(node),
          context: currentPath
        });
      } else if (Array.isArray(node)) {
        // If array of objects, detect tabular structure!
        if (node.length > 0 && typeof node[0] === 'object' && node[0] !== null) {
          const keys = Object.keys(node[0]).slice(0, 10); // Take first 10 columns
          const rows: string[][] = [];
          for (let i = 0; i < Math.min(node.length, 50); i++) {
            const item = node[i];
            if (typeof item === 'object' && item !== null) {
              rows.push(keys.map(k => {
                const v = item[k];
                if (v === undefined || v === null) return '';
                return typeof v === 'object' ? JSON.stringify(v) : String(v);
              }));
            }
          }
          if (keys.length > 0 && rows.length > 0) {
            for (const row of rows) {
              for (let c = 0; c < row.length; c++) {
                if (row[c] === '[object Object]') row[c] = '';
              }
            }
            tables.push({
              id: `json_tbl_${tables.length + 1}`,
              caption: `Mảng dữ liệu: ${currentPath || '$'} (${node.length} phần tử)`,
              headers: keys,
              rows
            });
          }
        }

        node.forEach((item, index) => {
          walk(item, currentPath ? `${currentPath}[${index}]` : `$[${index}]`, node, parent, String(index), semanticKey);
        });
      } else if (typeof node === 'object') {
        Object.entries(node).forEach(([k, v]) => {
          walk(v, currentPath ? `${currentPath}.${k}` : `$.${k}`, node, parent, k, semanticKey);
        });
      }
    };

    walk(data, '');

    const { numberStats, numberStatsByType } = summarizeNumbers(numbers);

    return {
      isHtml: false,
      isJson: true,
      texts,
      numbers,
      images,
      links,
      tables,
      numberStats,
      numberStatsByType,
      summary: {
        totalItems: texts.length + numbers.length + images.length + links.length + tables.length,
        textCount: texts.length,
        numberCount: numbers.length,
        imageCount: images.length,
        linkCount: links.length,
        tableCount: tables.length
      }
    };
  } catch {
    // If not JSON, treat as raw text
    const textLines = jsonStr.split('\n').filter(l => l.trim().length > 0);
    textLines.forEach((line, idx) => {
      texts.push({
        id: Math.random().toString(36).substring(2, 9),
        category: 'text',
        type: 'paragraph',
        label: `Dòng #${idx + 1}`,
        value: line.trim(),
        context: `Line ${idx + 1}`,
        length: line.trim().length
      });
      numbers.push(...extractNumbersFromText(line, `Dòng #${idx + 1}`));
    });

    const { numberStats, numberStatsByType } = summarizeNumbers(numbers);

    return {
      isHtml: false,
      isJson: false,
      texts,
      numbers,
      images,
      links,
      tables,
      numberStats,
      numberStatsByType,
      summary: {
        totalItems: texts.length + numbers.length,
        textCount: texts.length,
        numberCount: numbers.length,
        imageCount: 0,
        linkCount: 0,
        tableCount: 0
      }
    };
  }
}

/**
 * PARSER CHUNG TỰ ĐỘNG NHẬN DIỆN HTML HAY JSON
 */
export function harvestResponseData(body: string, contentType: string = '', baseUrl?: string): HarvesterResult {
  if (!body || typeof body !== 'string') {
    return {
      isHtml: false,
      isJson: false,
      texts: [],
      numbers: [],
      images: [],
      links: [],
      tables: [],
      numberStats: { count: 0, min: 0, max: 0, sum: 0, avg: 0 },
      numberStatsByType: {},
      summary: { totalItems: 0, textCount: 0, numberCount: 0, imageCount: 0, linkCount: 0, tableCount: 0 }
    };
  }

  const trimmed = body.trim();
  const isHtml = contentType.toLowerCase().includes('html') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    (trimmed.includes('<body') && trimmed.includes('</body>'));

  if (isHtml) {
    return parseHtmlData(body, baseUrl);
  }

  return parseJsonData(body);
}

/**
 * BỘ BÓC TÁCH TÙY BIẾN THEO CSS SELECTOR CHO HTML
 */
export function queryByCssSelector(html: string, selector: string, baseUrl?: string): {
  texts: string[];
  attributes: { src?: string; href?: string; alt?: string; title?: string }[];
  elementsCount: number;
} {
  if (!html || !selector.trim()) {
    return { texts: [], attributes: [], elementsCount: 0 };
  }

  if (typeof DOMParser === 'undefined') {
    // Basic regex fallback for class/tag
    const cleanSel = selector.trim().toLowerCase();
    const texts: string[] = [];
    const attributes: { src?: string; href?: string; alt?: string; title?: string }[] = [];

    // Tag matching: e.g. "h3" or "img"
    const tagMatch = /^[a-z0-9]+/i.exec(cleanSel);
    const classMatch = /\.([a-z0-9_-]+)/i.exec(cleanSel);

    const tag = tagMatch ? tagMatch[0] : '[a-z0-9]+';
    const classFilter = classMatch ? classMatch[1] : null;

    const isVoid = /^(img|input|br|hr|meta|link)$/i.test(tag);
    const regex = isVoid
      ? new RegExp(`<(${tag})\\b([^>]*?)(?:\\/>|>)`, 'gis')
      : new RegExp(`<(${tag})\\b([^>]*)>(.*?)(?:<\\/\\1>|$)`, 'gis');
    let m: RegExpExecArray | null;
    let matchCount = 0;
    while ((m = regex.exec(html)) !== null) {
      const attrs = m[2];
      if (classFilter && !new RegExp(`class=["'][^"']*\\b${classFilter}\\b[^"']*["']`, 'i').test(attrs)) {
        continue;
      }
      matchCount++;
      const text = isVoid ? '' : m[3].replace(/<[^>]+>/g, '').trim();
      if (text) texts.push(text);

      const srcM = /src=["']([^"']+)["']/i.exec(attrs);
      const hrefM = /href=["']([^"']+)["']/i.exec(attrs);
      const altM = /alt=["']([^"']*)["']/i.exec(attrs);
      const titleM = /title=["']([^"']*)["']/i.exec(attrs);

      if (srcM || hrefM || altM || titleM) {
        attributes.push({
          src: srcM ? resolveUrl(srcM[1], baseUrl) : undefined,
          href: hrefM ? resolveUrl(hrefM[1], baseUrl) : undefined,
          alt: altM ? altM[1] : undefined,
          title: titleM ? titleM[1] : undefined
        });
      }
    }

    return {
      texts,
      attributes,
      elementsCount: matchCount
    };
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const matches = doc.querySelectorAll(selector.trim());
    const texts: string[] = [];
    const attributes: { src?: string; href?: string; alt?: string; title?: string }[] = [];

    matches.forEach(el => {
      const text = el.textContent?.trim();
      if (text) texts.push(text);

      const src = el.getAttribute('src');
      const href = el.getAttribute('href');
      const alt = el.getAttribute('alt');
      const title = el.getAttribute('title');

      if (src || href || alt || title) {
        attributes.push({
          src: src ? resolveUrl(src, baseUrl) : undefined,
          href: href ? resolveUrl(href, baseUrl) : undefined,
          alt: alt || undefined,
          title: title || undefined
        });
      }
    });

    return {
      texts,
      attributes,
      elementsCount: matches.length
    };
  } catch (err) {
    console.error('Invalid CSS Selector:', err);
    return { texts: [], attributes: [], elementsCount: 0 };
  }
}

/**
 * BỘ BÓC TÁCH TÙY BIẾN THEO REGEX
 */
export function queryByRegex(text: string, patternStr: string, flags: string = 'gi'): string[] {
  if (!text || !patternStr.trim()) return [];
  try {
    // A global flag is required for exec() to advance through the text.
    const regex = new RegExp(patternStr, flags.includes('g') ? flags : flags + 'g');
    const results: string[] = [];
    let match: RegExpExecArray | null;
    while (results.length < 500 && (match = regex.exec(text)) !== null) {
      if (match[0] === '') {
        // Zero-length match ("a*", "^"): step forward or exec() loops forever.
        regex.lastIndex++;
        if (regex.lastIndex > text.length) break;
        continue;
      }
      results.push(match[1] !== undefined ? match[1] : match[0]);
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * XUẤT CSV CHO TOÀN BỘ DỮ LIỆU
 */
export function exportToCsvString(headers: string[], rows: (string | number)[][]): string {
  const escapeCell = (val: string | number) => {
    let str = String(val === undefined || val === null ? '' : val);
    // Scraped text must not become a spreadsheet formula (=, +, -, @, tab, CR).
    if (typeof val === 'string' && /^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map(row => row.map(escapeCell).join(','))
  ];
  return lines.join('\n');
}
