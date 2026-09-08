/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Palette guidata da variabili CSS (definite in src/theme.css), cosi'
        // sia il colore di brand (primary/secondary) sia la modalità dark/light
        // possono cambiare A RUNTIME senza dover ricompilare Tailwind: basta
        // aggiornare le variabili CSS sull'elemento <html> (vedi src/theme.js).
        // La sintassi "rgb(var(--x) / <alpha-value>)" è il pattern ufficiale
        // Tailwind per supportare anche i modificatori di opacità (es. bg-brand-primary/15).
        brand: {
          primary: 'rgb(var(--brand-primary) / <alpha-value>)',
          secondary: 'rgb(var(--brand-secondary) / <alpha-value>)',
          bg: 'rgb(var(--brand-bg) / <alpha-value>)',
          surface: 'rgb(var(--brand-surface) / <alpha-value>)',
          surfaceAlt: 'rgb(var(--brand-surface-alt) / <alpha-value>)',
          border: 'rgb(var(--brand-border) / <alpha-value>)',
          text: 'rgb(var(--brand-text) / <alpha-value>)',
          textMuted: 'rgb(var(--brand-text-muted) / <alpha-value>)'
        },
        // Mantenuta per retrocompatibilità: alias fissi sui colori ufficiali ISP,
        // utili solo per elementi che devono restare SEMPRE blu/arancio ISP
        // indipendentemente dal tema custom scelto (es. il logo nella landing page).
        isp: {
          blue: '#005A9C',
          orange: '#FF6600'
        }
      }
    },
  },
  plugins: [],
}
