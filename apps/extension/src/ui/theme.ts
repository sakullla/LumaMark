/** Appearance preferences. They live in localStorage so every extension page can read them before its first paint. */
export type ThemeChoice = 'system' | 'light' | 'dark';
export type AccentChoice = 'iris' | 'ember' | 'rose' | 'ocean' | 'jade' | 'graphite';

export interface Preferences {
  theme: ThemeChoice;
  accent: AccentChoice;
}

export const ACCENTS: readonly AccentChoice[] = ['iris', 'ember', 'rose', 'ocean', 'jade', 'graphite'];

const KEYS = { theme: 'lumamark-theme', accent: 'lumamark-accent' } as const;

function stored(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}

export function readPreferences(): Preferences {
  const theme = stored(KEYS.theme);
  const accent = stored(KEYS.accent) as AccentChoice | null;
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    accent: accent && ACCENTS.includes(accent) ? accent : 'iris',
  };
}

export function resolvedTheme(theme: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

const darkQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined);

export function applyPreferences(root: HTMLElement = document.documentElement, preferences = readPreferences()): void {
  root.dataset.theme = resolvedTheme(preferences.theme, Boolean(darkQuery()?.matches));
  root.dataset.accent = preferences.accent;
}

export function savePreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  try { globalThis.localStorage?.setItem(KEYS[key], value); } catch { /* the choice lasts for this page only */ }
  applyPreferences();
}

/** Follow the system theme, and appearance changes made on another open LumaMark page. */
export function watchPreferences(): void {
  darkQuery()?.addEventListener('change', () => applyPreferences());
  globalThis.addEventListener?.('storage', (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith('lumamark-')) applyPreferences();
  });
}
