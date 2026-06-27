import type { CSSProperties } from 'react';
import type { ProfileTheme } from './types';

const DEFAULT_PROFILE_THEME: ProfileTheme = {
  primaryColor: '#6fa8ff',
  secondaryColor: '#0b1220',
  accentColor: '#ff9f0a',
  backgroundGradient: 'linear-gradient(135deg, rgba(111,168,255,0.18), rgba(255,159,10,0.12))',
  tileStyle: 'certifyd',
};

type ThemeSource = ProfileTheme | { profileTheme?: ProfileTheme | null } | Record<string, unknown> | null | undefined;

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

function normalizeHex(value: unknown, fallback: string): string {
  if (!isHexColor(value)) return fallback;
  const hex = value.trim().toLowerCase();
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex, DEFAULT_PROFILE_THEME.accentColor).replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function mixWithWhite(hex: string, amount = 0.36): string {
  const { r, g, b } = hexToRgb(hex);
  const mixed = {
    r: Math.round(r + (255 - r) * amount),
    g: Math.round(g + (255 - g) * amount),
    b: Math.round(b + (255 - b) * amount),
  };
  return `#${[mixed.r, mixed.g, mixed.b].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

function rgbTriplet(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function extractProfileTheme(source: ThemeSource): ProfileTheme | null {
  if (!source) return null;
  if ('profileTheme' in source) {
    const nested = source.profileTheme;
    return nested && typeof nested === 'object' ? extractProfileTheme(nested as ThemeSource) : null;
  }
  if ('primaryColor' in source || 'secondaryColor' in source || 'accentColor' in source) {
    return source as ProfileTheme;
  }
  const row = source as Record<string, unknown>;
  const accentColor = pickString(row, ['themeAccentOverrideColor', 'themeAccentColor', 'themeButtonColor', 'themeBorderColor']);
  const primaryColor = pickString(row, ['themeButtonColor', 'themeAccentOverrideColor', 'themeAccentColor']);
  const secondaryColor = pickString(row, ['themeBackgroundColor', 'themeCardColor', 'themeBorderColor']);
  if (accentColor || primaryColor || secondaryColor) {
    const accent = accentColor || primaryColor || DEFAULT_PROFILE_THEME.accentColor;
    const primary = primaryColor || accent;
    const secondary = secondaryColor || DEFAULT_PROFILE_THEME.secondaryColor;
    return {
      primaryColor: primary,
      secondaryColor: secondary,
      accentColor: accent,
      backgroundGradient: `linear-gradient(135deg, ${secondary} 0%, rgba(0,0,0,0.84) 48%, ${accent} 140%)`,
      tileStyle: pickString(row, ['themeMode', 'themeButtonStyle']) || 'creator-profile',
    };
  }
  return null;
}

export function getProfileTheme(source: ThemeSource): ProfileTheme {
  const profileTheme = extractProfileTheme(source);
  const primaryColor = normalizeHex(profileTheme?.primaryColor, DEFAULT_PROFILE_THEME.primaryColor);
  const secondaryColor = normalizeHex(profileTheme?.secondaryColor, DEFAULT_PROFILE_THEME.secondaryColor);
  const accentColor = normalizeHex(profileTheme?.accentColor, DEFAULT_PROFILE_THEME.accentColor);
  return {
    primaryColor,
    secondaryColor,
    accentColor,
    backgroundGradient: typeof profileTheme?.backgroundGradient === 'string' && profileTheme.backgroundGradient.trim()
      ? profileTheme.backgroundGradient
      : DEFAULT_PROFILE_THEME.backgroundGradient,
    tileStyle: typeof profileTheme?.tileStyle === 'string' && profileTheme.tileStyle.trim()
      ? profileTheme.tileStyle
      : DEFAULT_PROFILE_THEME.tileStyle,
  };
}

export function getReadableAccentColor(source: ThemeSource): string {
  const accent = getProfileTheme(source).accentColor;
  return relativeLuminance(accent) < 0.22 ? mixWithWhite(accent) : accent;
}

export function getCardThemeVars(source: ThemeSource): CSSProperties {
  const theme = getProfileTheme(source);
  const accent = getReadableAccentColor(theme);
  const primary = theme.primaryColor;
  const secondary = theme.secondaryColor;
  const primaryRgb = rgbTriplet(primary);
  const secondaryRgb = rgbTriplet(secondary);
  const accentRgb = rgbTriplet(accent);
  return {
    '--profile-primary': primary,
    '--profile-secondary': secondary,
    '--profile-accent': accent,
    '--profile-primary-rgb': primaryRgb,
    '--profile-secondary-rgb': secondaryRgb,
    '--profile-accent-rgb': accentRgb,
    '--profile-gradient': theme.backgroundGradient,
    '--profile-tile-style': theme.tileStyle,
    background: [
      'linear-gradient(180deg, rgba(0,0,0,0.16), rgba(0,0,0,0.34))',
      `radial-gradient(circle at 8% 0%, rgba(${accentRgb}, 0.72), transparent 56%)`,
      `radial-gradient(circle at 100% 18%, rgba(${primaryRgb}, 0.58), transparent 58%)`,
      `linear-gradient(135deg, rgba(${accentRgb}, 0.52), rgba(${primaryRgb}, 0.44))`,
    ].join(', '),
    borderColor: `rgba(${accentRgb}, 0.16)`,
    boxShadow: `0 18px 48px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.04), 0 0 30px rgba(${accentRgb}, 0.2)`,
  } as CSSProperties;
}
