// Utility del sistema di theming dinamico + sessione utente "mock" (demo).
//
// IMPORTANTE: questo NON è un sistema di autenticazione reale. Non esiste un
// database utenti né una verifica password lato backend: serve solo a
// simulare un flusso di accesso per la demo. Per un uso reale andrebbe
// sostituito con un vero provider di identità (SSO aziendale, OAuth, ecc.).

const THEME_STORAGE_KEY = 'nvb_hub_theme';
const SESSION_STORAGE_KEY = 'nvb_hub_session';

export const DEFAULT_THEME = {
  companyName: 'NovaBanca',
  logoMark: 'NVB',
  primaryColor: '#005A9C',
  secondaryColor: '#FF6600',
  mode: 'dark' // 'dark' | 'light'
};

// Preset rapidi proposti nel wizard, per chi non vuole scegliere un colore da zero
export const THEME_PRESETS = [
  { id: 'nvb_default', label: 'NovaBanca (default)', primaryColor: '#005A9C', secondaryColor: '#FF6600' },
  { id: 'emerald_tech', label: 'Emerald Tech', primaryColor: '#047857', secondaryColor: '#0EA5E9' },
  { id: 'crimson_finance', label: 'Crimson Finance', primaryColor: '#9F1239', secondaryColor: '#F59E0B' },
  { id: 'violet_innovation', label: 'Violet Innovation', primaryColor: '#5B21B6', secondaryColor: '#EC4899' }
];

// Converte un colore hex (#RRGGBB) nella tripletta "R G B" richiesta dalle
// variabili CSS del tema (vedi theme.css). Ritorna null se il formato non è valido.
export function hexToRgbTriplet(hex) {
  if (!hex) return null;
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `${r} ${g} ${b}`;
}

// Applica il tema corrente al documento: imposta le variabili CSS di brand e
// aggiunge/rimuove la classe "light" su <html> per attivare le variabili di
// superficie/testo chiare definite in theme.css.
export function applyThemeToDocument(theme) {
  const root = document.documentElement;

  const primaryRgb = hexToRgbTriplet(theme.primaryColor);
  const secondaryRgb = hexToRgbTriplet(theme.secondaryColor);

  if (primaryRgb) root.style.setProperty('--brand-primary', primaryRgb);
  if (secondaryRgb) root.style.setProperty('--brand-secondary', secondaryRgb);

  if (theme.mode === 'light') {
    root.classList.add('light');
  } else {
    root.classList.remove('light');
  }
}

export function loadTheme() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_THEME, ...parsed };
  } catch (e) {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch (e) {
    console.warn('[theme] Impossibile salvare il tema in localStorage:', e.message);
  }
}

// --- Sessione utente "mock" (solo per la demo, vedi nota in cima al file) ---

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (e) {
    console.warn('[theme] Impossibile salvare la sessione in localStorage:', e.message);
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (e) {}
}
