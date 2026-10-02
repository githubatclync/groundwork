import { describe, expect, it } from 'vitest';
import { resolveImageSrc } from './descriptionHtml';
import { formatArea, formatLength } from './format';

describe('resolveImageSrc', () => {
  it('allows data image URLs and https', () => {
    expect(resolveImageSrc('data:image/png;base64,AAA', 'L1')).toBe('data:image/png;base64,AAA');
    expect(resolveImageSrc('https://example.com/a.png', 'L1')).toBe('https://example.com/a.png');
  });

  it('refuses other schemes and non-image data URLs', () => {
    for (const bad of [
      'http://example.com/a.png',
      'javascript:alert(1)',
      'file:///C:/x.png',
      'C:\\pics\\a.png',
      '//example.com/a.png',
      'data:text/html;base64,AAA',
      'data:image/svg+xml;base64,AAA',
      '',
    ]) {
      expect(resolveImageSrc(bad, 'L1'), bad).toBeNull();
    }
  });

  it('maps relative paths to the layer resource protocol', () => {
    expect(resolveImageSrc('files/a b.png', 'L7', true)).toBe(
      'http://kmz.localhost/L7/files/a%20b.png',
    );
    expect(resolveImageSrc('.\\img\\a.png', 'L7', false)).toBe('kmz://localhost/L7/img/a.png');
  });

  it('refuses paths that climb out of the layer', () => {
    expect(resolveImageSrc('../secret.png', 'L1')).toBeNull();
    expect(resolveImageSrc('a/../../b.png', 'L1')).toBeNull();
  });
});

describe('format', () => {
  it('formats lengths', () => {
    expect(formatLength(12.34)).toBe('12.3 m');
    expect(formatLength(1500)).toBe('1.50 km');
    expect(formatLength(250_000)).toBe('250.0 km');
  });
  it('formats areas', () => {
    expect(formatArea(500)).toBe('500.0 m²');
    expect(formatArea(50_000)).toBe('5.00 ha');
    expect(formatArea(12_364_000_000)).toBe('12364.0 km²');
  });
});
