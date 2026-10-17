import { describe, it, expect } from 'vitest';
import { translations } from '../i18n/translations';

describe('Theme & i18n Systems', () => {
  it('should have matching keys in Vietnamese and English dictionaries', () => {
    const viKeys = Object.keys(translations.vi);
    const enKeys = Object.keys(translations.en);

    expect(viKeys.length).toBeGreaterThan(0);
    expect(enKeys.length).toBeGreaterThan(0);

    // Verify all VI keys exist in EN dictionary
    for (const key of viKeys) {
      expect((translations.en as any)[key]).toBeDefined();
    }
  });

  it('should translate common keys accurately', () => {
    expect(translations.vi['nav.apis']).toBe('📁 APIs');
    expect(translations.en['nav.apis']).toBe('📁 APIs');

    expect(translations.vi['theme.toggle']).toContain('Sáng / Tối');
    expect(translations.en['theme.toggle']).toContain('Light / Dark');

    expect(translations.vi['common.search']).toBe('Tìm kiếm...');
    expect(translations.en['common.search']).toBe('Search...');
  });

  it('should support parameter interpolation', () => {
    const template = translations.vi['sidebar.filterResults'];
    expect(template).toContain('{count}');
    const formatted = template.replace('{count}', '42');
    expect(formatted).toBe('Kết quả lọc (42)');
  });
});
