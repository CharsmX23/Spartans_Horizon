export type AccentKey = 'ember' | 'nebula' | 'ion' | 'supernova' | 'aurora';

export interface Accent {
  key: AccentKey;
  name: string;
  hex: string;
}

export const ACCENTS: Record<AccentKey, Accent> = {
  ember: { key: 'ember', name: 'Ember', hex: '#E8102A' },
  nebula: { key: 'nebula', name: 'Nebula', hex: '#8B5CF6' },
  ion: { key: 'ion', name: 'Ion', hex: '#38BDF8' },
  supernova: { key: 'supernova', name: 'Supernova', hex: '#F5A524' },
  aurora: { key: 'aurora', name: 'Aurora', hex: '#34D399' },
};

export const ACCENT_LIST = Object.values(ACCENTS);

// Friendly default match by display name (case-insensitive)
export function defaultAccentForName(name: string): AccentKey {
  const n = name.trim().toLowerCase();
  if (n === 'charsm') return 'ember';
  if (n === 'madhi') return 'nebula';
  return 'ember';
}

export function applyAccent(hex: string) {
  const root = document.documentElement;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-soft', `${hex}26`);
  root.style.setProperty('--accent-glow', `${hex}73`);
}
