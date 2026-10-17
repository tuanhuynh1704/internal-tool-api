import { describe, it, expect } from 'vitest';
import {
  parseHtmlData,
  parseJsonData,
  harvestResponseData,
  extractNumbersFromText,
  computeNumberStats,
  resolveUrl,
  detectImageFormat,
  queryByCssSelector,
  queryByRegex,
  exportToCsvString
} from './dataHarvesterEngine';

describe('Data Harvester Engine Tests', () => {
  describe('HTML Webpage Harvester', () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <title>Siêu thị Công nghệ - Mua sắm Online</title>
        <meta name="description" content="Trang mua sắm điện thoại, laptop chính hãng với giá tốt nhất." />
        <meta property="og:title" content="Siêu thị Công nghệ Official" />
        <meta property="og:image" content="https://example.com/assets/banner-og.png" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        <header>
          <h1>Chào mừng đến với Cửa Hàng</h1>
          <p>Giảm giá mùa hè lên đến 35% cho mọi đơn hàng!</p>
        </header>

        <section class="products">
          <div class="product-item">
            <h2>iPhone 15 Pro Max</h2>
            <p class="desc">Điện thoại thông minh cao cấp nhất năm 2024.</p>
            <span class="price">32,990,000₫</span>
            <span class="discount">Ưu đãi giảm $150</span>
            <span class="rating">Đánh giá 4.9/5 sao</span>
            <img src="/images/iphone-15.jpg" alt="iPhone 15 Pro Max Mới" width="400" height="400" />
            <a href="/products/iphone-15">Chi tiết sản phẩm</a>
          </div>

          <div class="product-item" style="background-image: url('/images/bg-hero.webp');">
            <h3>MacBook Air M3</h3>
            <span class="price">$1,099.00</span>
            <img src="https://cdn.example.com/macbook-air.png" alt="MacBook Air" />
            <a href="https://external.apple.com/buy">Mua tại Apple</a>
          </div>
        </section>

        <table>
          <caption>Bảng thông số kỹ thuật</caption>
          <thead>
            <tr><th>Thông số</th><th>Giá trị</th></tr>
          </thead>
          <tbody>
            <tr><td>RAM</td><td>16 GB</td></tr>
            <tr><td>Bộ nhớ</td><td>512 GB</td></tr>
          </tbody>
        </table>
      </body>
      </html>
    `;

    it('extracts titles, headings, and paragraphs from HTML', () => {
      const res = parseHtmlData(sampleHtml, 'https://example.com');
      expect(res.isHtml).toBe(true);

      const title = res.texts.find(t => t.type === 'title');
      expect(title?.value).toBe('Siêu thị Công nghệ - Mua sắm Online');

      const h1 = res.texts.find(t => t.type === 'heading' && t.label.includes('H1'));
      expect(h1?.value).toBe('Chào mừng đến với Cửa Hàng');

      const h2 = res.texts.find(t => t.type === 'heading' && t.label.includes('H2'));
      expect(h2?.value).toBe('iPhone 15 Pro Max');

      const meta = res.texts.find(t => t.type === 'meta' && t.label.includes('Description'));
      expect(meta?.value).toContain('Trang mua sắm điện thoại');
    });

    it('extracts numbers, prices, and percentages from HTML', () => {
      const res = parseHtmlData(sampleHtml, 'https://example.com');

      // Price in VND: 32,990,000₫
      const vndPrice = res.numbers.find(n => n.type === 'price' && n.rawText.includes('₫'));
      expect(vndPrice).toBeDefined();
      expect(vndPrice?.value).toBe(32990000);

      // Price in USD: $150 or $1,099.00
      const usdPrice = res.numbers.find(n => n.type === 'price' && n.rawText.includes('$150'));
      expect(usdPrice).toBeDefined();
      expect(usdPrice?.value).toBe(150);

      // Percentage: 35%
      const pct = res.numbers.find(n => n.type === 'percentage');
      expect(pct?.value).toBe(35);

      // Rating: 4.9
      const rating = res.numbers.find(n => n.type === 'rating');
      expect(rating?.value).toBe(4.9);

      // Number stats
      expect(res.numberStats.count).toBeGreaterThan(0);
      expect(res.numberStats.min).toBeLessThan(res.numberStats.max);
    });

    it('extracts images with fully resolved absolute URLs and formats', () => {
      const res = parseHtmlData(sampleHtml, 'https://example.com');
      expect(res.images.length).toBeGreaterThan(0);

      // Relative img resolved: /images/iphone-15.jpg -> https://example.com/images/iphone-15.jpg
      const iphoneImg = res.images.find(img => img.url.includes('iphone-15.jpg'));
      expect(iphoneImg?.url).toBe('https://example.com/images/iphone-15.jpg');
      expect(iphoneImg?.format).toBe('jpg');
      expect(iphoneImg?.alt).toBe('iPhone 15 Pro Max Mới');

      // Absolute image: https://cdn.example.com/macbook-air.png
      const macImg = res.images.find(img => img.url.includes('macbook-air.png'));
      expect(macImg?.url).toBe('https://cdn.example.com/macbook-air.png');
      expect(macImg?.format).toBe('png');

      // Background image: /images/bg-hero.webp -> https://example.com/images/bg-hero.webp
      const bgImg = res.images.find(img => img.url.includes('bg-hero.webp'));
      expect(bgImg?.url).toBe('https://example.com/images/bg-hero.webp');
      expect(bgImg?.format).toBe('webp');

      // OG image
      const ogImg = res.images.find(img => img.type === 'og_image');
      expect(ogImg?.url).toBe('https://example.com/assets/banner-og.png');
    });

    it('extracts links and tables', () => {
      const res = parseHtmlData(sampleHtml, 'https://example.com');

      const internalLink = res.links.find(l => l.url.includes('/products/iphone-15'));
      expect(internalLink?.url).toBe('https://example.com/products/iphone-15');
      expect(internalLink?.text).toBe('Chi tiết sản phẩm');

      expect(res.tables.length).toBe(1);
      expect(res.tables[0].headers).toEqual(['Thông số', 'Giá trị']);
      expect(res.tables[0].rows.length).toBe(2);
    });
  });

  describe('API (JSON) Harvester', () => {
    const sampleJson = JSON.stringify({
      status: 'success',
      totalProducts: 4,
      avgRating: 4.85,
      store: {
        name: 'TechStore Global',
        website: 'https://techstore.com',
        logoUrl: 'https://techstore.com/logo.svg',
        banner: 'https://techstore.com/banner.jpg'
      },
      products: [
        {
          id: 101,
          title: 'Mechanical Keyboard RGB',
          price: 89.99,
          stock: 45,
          image: 'https://images.unsplash.com/photo-keyboard.png',
          tags: ['keyboard', 'rgb', 'gaming']
        },
        {
          id: 102,
          title: 'Wireless Gaming Mouse',
          price: 49.50,
          stock: 120,
          avatar: 'https://images.unsplash.com/photo-mouse.webp',
          tags: ['mouse', 'wireless']
        }
      ]
    });

    it('recursively parses JSON fields and extracts strings, numbers, and image URLs', () => {
      const res = parseJsonData(sampleJson);
      expect(res.isJson).toBe(true);

      // Extracted Strings
      const storeName = res.texts.find(t => t.value === 'TechStore Global');
      expect(storeName).toBeDefined();

      const prodTitle = res.texts.find(t => t.value === 'Mechanical Keyboard RGB');
      expect(prodTitle).toBeDefined();

      // Extracted Numbers
      const price1 = res.numbers.find(n => n.context.includes('products[0].price'));
      expect(price1?.value).toBe(89.99);
      expect(price1?.type).toBe('price');

      const stock2 = res.numbers.find(n => n.context.includes('products[1].stock'));
      expect(stock2?.value).toBe(120);

      // Extracted Images
      expect(res.images.length).toBeGreaterThanOrEqual(4);
      const logo = res.images.find(img => img.url.includes('logo.svg'));
      expect(logo?.format).toBe('svg');

      const kbImg = res.images.find(img => img.url.includes('photo-keyboard.png'));
      expect(kbImg?.format).toBe('png');
      expect(kbImg?.alt).toBe('Mechanical Keyboard RGB');
      expect(kbImg?.source).toBe('$.products[0].image');

      const mouseImg = res.images.find(img => img.url.includes('photo-mouse.webp'));
      expect(mouseImg?.format).toBe('webp');
      expect(mouseImg?.alt).toBe('Wireless Gaming Mouse');
      expect(mouseImg?.source).toBe('$.products[1].avatar');

      // Tabular data extracted from array of objects
      expect(res.tables.length).toBeGreaterThanOrEqual(1);
      expect(res.tables[0].headers).toContain('title');
      expect(res.tables[0].headers).toContain('price');

      // Stats
      expect(res.numberStats.count).toBeGreaterThan(0);
      expect(res.numberStats.avg).toBeGreaterThan(0);
    });

    it('extracts real product names for JSON arrays instead of generic JSONPaths $[0].image', () => {
      const productListJson = JSON.stringify([
        {
          id: 1,
          title: 'Hydrating Face Moisturizer',
          price: 19.99,
          image: 'https://images.example.com/products/cerave-hydrating.jpg'
        },
        {
          id: 2,
          name: 'Revitalizing Shampoo',
          price: 12.50,
          image: 'https://images.example.com/products/shampoo.png'
        },
        {
          id: 3,
          price: 8.00,
          image: 'https://images.example.com/products/standalone-photo.webp'
        }
      ]);

      const res = parseJsonData(productListJson);
      expect(res.images.length).toBe(3);

      // Item 0: Should take 'title'
      expect(res.images[0].alt).toBe('Hydrating Face Moisturizer');
      expect(res.images[0].source).toBe('$[0].image');

      // Item 1: Should take 'name'
      expect(res.images[1].alt).toBe('Revitalizing Shampoo');
      expect(res.images[1].source).toBe('$[1].image');

      // Item 2: No title/name, should take filename from URL
      expect(res.images[2].alt).toBe('standalone-photo.webp');
      expect(res.images[2].source).toBe('$[2].image');
    });
  });

  describe('CSS Selector & Regex queries', () => {
    const htmlSnippet = `
      <div class="user-card">
        <h3 class="name">Nguyen Van A</h3>
        <span class="phone">0901-234-567</span>
        <img class="avatar" src="https://api.avatar.com/u1.png" alt="Avatar" />
      </div>
      <div class="user-card">
        <h3 class="name">Tran Thi B</h3>
        <span class="phone">0912-345-678</span>
        <img class="avatar" src="https://api.avatar.com/u2.png" alt="Avatar" />
      </div>
    `;

    it('queries HTML using CSS selector', () => {
      const result = queryByCssSelector(htmlSnippet, 'h3.name');
      expect(result.elementsCount).toBe(2);
      expect(result.texts).toEqual(['Nguyen Van A', 'Tran Thi B']);

      const imgResult = queryByCssSelector(htmlSnippet, 'img.avatar');
      expect(imgResult.elementsCount).toBe(2);
      expect(imgResult.attributes[0].src).toBe('https://api.avatar.com/u1.png');
    });

    it('extracts patterns using regex query', () => {
      const phoneMatches = queryByRegex(htmlSnippet, '09\\d{2}-\\d{3}-\\d{3}');
      expect(phoneMatches.length).toBe(2);
      expect(phoneMatches).toContain('0901-234-567');
      expect(phoneMatches).toContain('0912-345-678');
    });

    it('generates CSV string with proper escaping', () => {
      const headers = ['Tên', 'Giá', 'Ghi chú'];
      const rows = [
        ['Sản phẩm 1', 100, 'Mới, nguyên seal'],
        ['Sản phẩm "Pro"', 250, 'Bảo hành 12T']
      ];
      const csv = exportToCsvString(headers, rows);
      expect(csv).toContain('"Mới, nguyên seal"');
      expect(csv).toContain('"Sản phẩm ""Pro"""');
      expect(csv).toContain('Tên,Giá,Ghi chú');
    });
  });
});
