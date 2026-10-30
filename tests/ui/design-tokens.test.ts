import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENTS, readPreferences, resolvedTheme } from '../../apps/extension/src/ui/theme';

const css = readFileSync('apps/extension/src/styles/main.css', 'utf8');

function tokens(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp(`(?:^|[\\n,]\\s*)${escaped}(?:, [^{]*)? \\{([^}]*)\\}`))?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]));
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left: string, right: string): number {
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const light = tokens(':root');
const dark = tokens(':root[data-theme="dark"]');

describe('design tokens', () => {
  it.each([['light', light], ['dark', dark]])('keeps text readable on every %s surface', (_name, theme) => {
    for (const surface of ['canvas', 'surface', 'surface-raised', 'surface-sunken', 'sidebar']) {
      expect(contrast(theme.text, theme[surface]), `text on ${surface}`).toBeGreaterThanOrEqual(7);
      expect(contrast(theme.muted, theme[surface]), `muted on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const state of ['danger', 'success', 'warning']) {
      expect(contrast(theme[state], theme.surface), `${state} on surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(ACCENTS)('keeps the %s accent readable in both themes', (accent) => {
    const lightAccent = tokens(`:root[data-accent="${accent}"]`);
    const darkAccent = tokens(`:root[data-theme="dark"][data-accent="${accent}"]`);
    expect(contrast(light['on-accent'], lightAccent.accent), 'label on light button').toBeGreaterThanOrEqual(4.5);
    expect(contrast(light['on-accent'], lightAccent['accent-hover']), 'label on light hover').toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightAccent['accent-text'], light.canvas), 'accent text on light canvas').toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkAccent['on-accent'], darkAccent.accent), 'label on dark button').toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkAccent['on-accent'], darkAccent['accent-hover']), 'label on dark hover').toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkAccent['accent-text'], dark.surface), 'accent text on dark surface').toBeGreaterThanOrEqual(4.5);
  });

  it('avoids selectors the supported browsers do not all share', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/:has\(/);
    expect(rules).not.toMatch(/subgrid/);
  });

  it('respects the people who ask for less motion', () => {
    expect(css.indexOf('@media (prefers-reduced-motion: no-preference)')).toBeGreaterThan(0);
    expect(css).toContain('@keyframes dialog-in');
    expect(css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'))).not.toMatch(/\banimation:/);
  });

  it('resolves theme choices and ignores unknown stored values', () => {
    expect(resolvedTheme('system', true)).toBe('dark');
    expect(resolvedTheme('system', false)).toBe('light');
    expect(resolvedTheme('light', true)).toBe('light');
    expect(readPreferences()).toEqual({ theme: 'system', accent: 'iris' });
  });
});
