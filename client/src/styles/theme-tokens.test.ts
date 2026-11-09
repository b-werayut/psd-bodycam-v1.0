import { describe, expect, it } from 'vitest';
import appEntry from '../main.tsx?raw';
import globalStylesheet from './global.css?raw';
import stylesheet from './tailwind.css?raw';
import packageManifest from '../../package.json?raw';
import tailwindConfig from '../../tailwind.config.cjs?raw';

function themeBlock(selector: string) {
  const block = stylesheet.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
  if (!block) throw new Error(`Missing ${selector} theme block`);
  return block[1];
}

function oklchToken(block: string, token: string) {
  const value = block.match(
    new RegExp(`--${token}:\\s*(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)`),
  );
  if (!value) throw new Error(`Missing --${token} OKLCH token`);
  return value.slice(1).map(Number) as [number, number, number];
}

function oklchToLinearRgb([lightness, chroma, hue]: [number, number, number]) {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function relativeLuminance([red, green, blue]: number[]) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

describe('operations semantic theme', () => {
  const root = themeBlock(':root');
  const operations = themeBlock('.operations-theme');
  const roleTokens = [
    'canvas',
    'surface',
    'surface-raised',
    'text-primary',
    'text-secondary',
    'hairline',
    'structural',
    'brand-primary',
    'brand-accent',
    'brand-link',
    'status-info',
    'focus-ring',
    'status-success',
    'status-warning',
    'status-danger',
    'status-unknown',
  ] as const;

  function contrastRatio(foreground: [number, number, number], background: [number, number, number]) {
    const foregroundLuminance = relativeLuminance(oklchToLinearRgb(foreground));
    const backgroundLuminance = relativeLuminance(oklchToLinearRgb(background));
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }

  it('defines the approved role tokens for light and dark modes', () => {
    const dark = themeBlock('.dark');

    for (const token of roleTokens) {
      expect(oklchToken(root, token)).toBeDefined();
      expect(oklchToken(dark, token)).toBeDefined();
    }

    expect(oklchToken(root, 'canvas')).toEqual([0.985, 0.004, 255]);
    expect(oklchToken(root, 'surface')).toEqual([0.995, 0.003, 255]);
    expect(root).toContain('--skeleton-highlight: 0.995 0.003 255');
    expect(oklchToken(root, 'brand-primary')).toEqual([0.52, 0.2, 258]);
    expect(oklchToken(dark, 'canvas')).toEqual([0.13, 0.025, 258]);
    expect(oklchToken(dark, 'surface')).toEqual([0.17, 0.028, 258]);
    expect(oklchToken(dark, 'brand-primary')).toEqual([0.55, 0.2, 258]);
  });

  it('uses an AA-safe cobalt for actions and focus', () => {
    const primaryLuminance = relativeLuminance(
      oklchToLinearRgb(oklchToken(root, 'brand-primary')),
    );
    const contrastOnWhite = 1.05 / (primaryLuminance + 0.05);

    expect(contrastOnWhite).toBeGreaterThanOrEqual(4.5);
  });

  it.each([':root', '.dark'])(
    'keeps primary button copy at AA contrast in %s',
    (selector) => {
      const block = themeBlock(selector);

      expect(
        contrastRatio(
          oklchToken(block, 'primary-foreground'),
          oklchToken(block, 'brand-primary'),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([':root', '.dark'])(
    'keeps primary and secondary copy readable on canvas and working surfaces in %s',
    (selector) => {
      const block = themeBlock(selector);

      expect(
        contrastRatio(oklchToken(block, 'text-primary'), oklchToken(block, 'canvas')),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(oklchToken(block, 'text-primary'), oklchToken(block, 'surface')),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(oklchToken(block, 'text-secondary'), oklchToken(block, 'canvas')),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(oklchToken(block, 'warning-foreground'), oklchToken(block, 'surface')),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([':root', '.dark'])(
    'keeps brand-coloured text readable on working surfaces in %s',
    (selector) => {
      const block = themeBlock(selector);

      expect(
        contrastRatio(oklchToken(block, 'brand-link'), oklchToken(block, 'surface')),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(oklchToken(block, 'brand-link'), oklchToken(block, 'canvas')),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([':root', '.dark'])(
    'keeps the selected navigation label readable on its pill in %s',
    (selector) => {
      const block = themeBlock(selector);

      expect(
        contrastRatio(
          oklchToken(block, 'sidebar-active-foreground'),
          oklchToken(block, 'sidebar-active'),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('maps shadcn roles to one source of truth', () => {
    expect(root).toContain('--background: var(--canvas)');
    expect(root).toContain('--foreground: var(--text-primary)');
    expect(root).toContain('--card: var(--surface)');
    expect(root).toContain('--primary: var(--brand-primary)');
    expect(root).toContain('--muted-foreground: var(--text-secondary)');
    expect(root).toContain('--border: var(--hairline)');
    expect(root).toContain('--ring: var(--focus-ring)');
    expect(root).toContain('--success: var(--status-success)');
    expect(root).toContain('--warning: var(--status-warning)');
    expect(root).toContain('--destructive: var(--status-danger)');
    expect(operations).not.toMatch(/--(?:background|foreground|card|primary|border|ring):/);
  });

  it('exposes the unknown and brand-link roles as Tailwind colours', () => {
    expect(tailwindConfig).toContain("unknown: oklch('--status-unknown')");
    expect(tailwindConfig).toContain("link: oklch('--brand-link')");
    expect(tailwindConfig).toContain("accent: oklch('--brand-accent')");
  });

  it('does not recolor media with a global inversion filter', () => {
    expect(stylesheet).not.toMatch(/filter:\s*invert\(/);
  });

  it('serves Thai and English from one variable family with tabular figures for data', () => {
    const dependencies = JSON.parse(packageManifest).dependencies as Record<string, string>;

    expect(dependencies['@fontsource-variable/noto-sans-thai']).toBeTruthy();
    expect(dependencies['@fontsource/sarabun']).toBeUndefined();
    expect(dependencies['@fontsource/geist-sans']).toBeUndefined();
    expect(dependencies['@fontsource/inter']).toBeUndefined();

    expect(appEntry).toContain("import '@fontsource-variable/noto-sans-thai'");
    expect(stylesheet).toContain(
      "--font-sans: 'Noto Sans Thai Variable', ui-sans-serif, system-ui, sans-serif",
    );
    expect(operations).toContain('font-family: var(--font-sans)');
    expect(globalStylesheet).toContain('font-family: var(--font-sans)');
    expect(tailwindConfig).toContain("sans: ['var(--font-sans)']");
    expect(globalStylesheet).toContain('font-variant-numeric: tabular-nums');
  });

  it('keeps readable prose at 16px with 1.5 line height while compact roles stay distinct', () => {
    expect(tailwindConfig).toContain("caption: ['12px', { lineHeight: '18px' }]");
    expect(tailwindConfig).toContain("control: ['14px', { lineHeight: '20px' }]");
    expect(tailwindConfig).toContain("body: ['16px', { lineHeight: '24px' }]");
    expect(tailwindConfig).toContain("base: ['16px', { lineHeight: '24px' }]");
  });
});
