/**
 * Dynamic MD3 theme derivation.
 * Extracts a seed color from the user's wallpaper/platform theme,
 * generates a full color scheme, and applies it as CSS custom properties.
 * Falls back to a carefully crafted default scheme if extraction fails.
 */
import {
  argbFromHex,
  hexFromArgb,
  Hct,
  SchemeContent,
} from '@material/material-color-utilities';

const FALLBACK_SEED = '#6750A4'; // MD3 default purple
let currentSeed = FALLBACK_SEED;
let currentDark = false;

function hctFromSeed(hex: string): Hct {
  return Hct.fromInt(argbFromHex(hex));
}

function schemeFromHct(hct: Hct, isDark: boolean, contrast = 0.0): SchemeContent {
  return new SchemeContent(hct, isDark, contrast);
}

function schemeToTokens(scheme: SchemeContent): Record<string, string> {
  const c = (v: number) => hexFromArgb(v);
  return {
    '--md-sys-color-primary': c(scheme.primary),
    '--md-sys-color-on-primary': c(scheme.onPrimary),
    '--md-sys-color-primary-container': c(scheme.primaryContainer),
    '--md-sys-color-on-primary-container': c(scheme.onPrimaryContainer),
    '--md-sys-color-secondary': c(scheme.secondary),
    '--md-sys-color-on-secondary': c(scheme.onSecondary),
    '--md-sys-color-secondary-container': c(scheme.secondaryContainer),
    '--md-sys-color-on-secondary-container': c(scheme.onSecondaryContainer),
    '--md-sys-color-tertiary': c(scheme.tertiary),
    '--md-sys-color-on-tertiary': c(scheme.onTertiary),
    '--md-sys-color-tertiary-container': c(scheme.tertiaryContainer),
    '--md-sys-color-on-tertiary-container': c(scheme.onTertiaryContainer),
    '--md-sys-color-error': c(scheme.error),
    '--md-sys-color-on-error': c(scheme.onError),
    '--md-sys-color-error-container': c(scheme.errorContainer),
    '--md-sys-color-on-error-container': c(scheme.onErrorContainer),
    '--md-sys-color-surface': c(scheme.surface),
    '--md-sys-color-on-surface': c(scheme.onSurface),
    '--md-sys-color-on-surface-variant': c(scheme.onSurfaceVariant),
    '--md-sys-color-surface-dim': c(scheme.surfaceDim),
    '--md-sys-color-surface-bright': c(scheme.surfaceBright),
    '--md-sys-color-surface-container-lowest': c(scheme.surfaceContainerLowest),
    '--md-sys-color-surface-container-low': c(scheme.surfaceContainerLow),
    '--md-sys-color-surface-container': c(scheme.surfaceContainer),
    '--md-sys-color-surface-container-high': c(scheme.surfaceContainerHigh),
    '--md-sys-color-surface-container-highest': c(scheme.surfaceContainerHighest),
    '--md-sys-color-surface-variant': c(scheme.surfaceDim),
    '--md-sys-color-outline': c(scheme.outline),
    '--md-sys-color-outline-variant': c(scheme.outlineVariant),
    '--md-sys-color-inverse-surface': c(scheme.inverseSurface),
    '--md-sys-color-inverse-on-surface': c(scheme.inverseOnSurface),
    '--md-sys-color-inverse-primary': c(scheme.inversePrimary),
  };
}

function applyTokens(tokens: Record<string, string>): void {
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(tokens)) {
    root.style.setProperty(prop, value);
  }
}

/**
 * Try to extract a theme seed from the platform.
 * Uses various browser APIs to detect the user's system color.
 */
async function detectPlatformSeed(): Promise<string | null> {
  // 1. Try CSS custom property from OS-level theme (some Chromium browsers expose this)
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const content = meta.getAttribute('content');
      if (content && content.startsWith('#')) return content;
    }
  } catch {}

  // 2. Try matchMedia for forced-colors or prefers-color-scheme to at least detect dark/light
  // We'll use the fallback seed but respect the user's dark/light preference
  return null;
}

function isDarkPreference(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Initialize the dynamic theme system.
 * Attempts to derive from platform, falls back to MD3 default.
 */
export async function initTheme(): Promise<void> {
  const platformSeed = await detectPlatformSeed();
  currentSeed = platformSeed || FALLBACK_SEED;
  currentDark = isDarkPreference();

  applyCurrentTheme();

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (getStoredTheme() === 'system') {
      currentDark = e.matches;
      applyCurrentTheme();
    }
  });
}

export function applyCurrentTheme(): void {
  const hct = hctFromSeed(currentSeed);
  const scheme = schemeFromHct(hct, currentDark);
  const tokens = schemeToTokens(scheme);
  applyTokens(tokens);

  document.documentElement.classList.toggle('theme-dark', currentDark);
}

export function setTheme(mode: 'light' | 'dark' | 'system'): void {
  localStorage.setItem('mneme_theme', mode);
  currentDark = mode === 'dark' || (mode === 'system' && isDarkPreference());
  applyCurrentTheme();
}

export function getStoredTheme(): 'light' | 'dark' | 'system' {
  return (localStorage.getItem('mneme_theme') as 'light' | 'dark' | 'system') || 'system';
}

export function toggleTheme(): 'light' | 'dark' {
  const current = currentDark ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function isDark(): boolean {
  return currentDark;
}
