// Configurazione centralizzata dell'URL base del backend.
//
// - In sviluppo locale / dietro Nginx (docker-compose): lasciare VITE_API_BASE_URL
//   non impostata. Le chiamate restano relative (es. "/api/chat") e vengono
//   gestite dal proxy Nginx (frontend/nginx.conf) o dal proxy di Vite in dev
//   (frontend/vite.config.js).
// - Se il frontend è deployato separatamente dal backend (GitHub Pages, Vercel,
//   Netlify, Render come sito statico...): impostare VITE_API_BASE_URL all'URL
//   completo del backend, es. "https://isp-backend-orchestrator.onrender.com".
export const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// Costruisce l'URL completo di un endpoint API, gestendo entrambi i casi sopra.
export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

// Risolve un URL "asset" (es. il chart_url restituito dal Data Agent, tipo
// "/static/charts/chart_xyz.png") in un URL assoluto quando il backend non è
// sulla stessa origin del frontend. Se il path è già assoluto (http/https),
// lo lascia invariato.
export function resolveAssetUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}
