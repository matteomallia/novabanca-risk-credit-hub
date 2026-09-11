import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Moon, Sun, Building2, Palette } from 'lucide-react';
import { THEME_PRESETS, DEFAULT_THEME } from '../theme';

// Wizard di personalizzazione white-label: raccoglie nome azienda, logo
// testuale, colori (preset o custom) e modalità dark/light, con anteprima
// live prima di confermare ed entrare nell'Hub.
export const OnboardingWizard = ({ onConfirm, onBack }) => {
  const [draft, setDraft] = useState({ ...DEFAULT_THEME, companyName: '', logoMark: '' });

  const applyPreset = (preset) => {
    setDraft((d) => ({ ...d, primaryColor: preset.primaryColor, secondaryColor: preset.secondaryColor }));
  };

  const handleConfirm = () => {
    onConfirm({
      companyName: draft.companyName.trim() || 'La Tua Azienda',
      logoMark: draft.logoMark.trim().slice(0, 4).toUpperCase() || 'HUB',
      primaryColor: draft.primaryColor,
      secondaryColor: draft.secondaryColor,
      mode: draft.mode
    });
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text flex items-center justify-center p-6">
      <div className="bg-brand-surface border border-brand-border rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden">
        <div className="bg-nvb-orange px-6 py-4 flex items-center space-x-2">
          <Palette className="w-5 h-5 text-white" />
          <h2 className="text-white font-semibold text-sm">Configura il tuo Hub</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
          {/* COLONNA SINISTRA: form */}
          <div className="space-y-5">
            <div>
              <label className="text-[11px] text-brand-textMuted flex items-center space-x-1 mb-1">
                <Building2 className="w-3 h-3" /><span>Nome Azienda</span>
              </label>
              <input
                type="text"
                value={draft.companyName}
                onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
                placeholder="es. Banca Alpha"
                className="w-full bg-brand-surfaceAlt border border-brand-border rounded-lg px-3 py-2 text-xs text-brand-text placeholder-brand-textMuted focus:outline-none focus:border-brand-primary transition-colors"
              />
            </div>

            <div>
              <label className="text-[11px] text-brand-textMuted mb-1 block">Logo (sigla, max 4 caratteri)</label>
              <input
                type="text"
                value={draft.logoMark}
                onChange={(e) => setDraft({ ...draft, logoMark: e.target.value })}
                placeholder="es. BA"
                maxLength={4}
                className="w-full bg-brand-surfaceAlt border border-brand-border rounded-lg px-3 py-2 text-xs text-brand-text placeholder-brand-textMuted focus:outline-none focus:border-brand-primary transition-colors uppercase"
              />
            </div>

            <div>
              <label className="text-[11px] text-brand-textMuted mb-1.5 block">Preset colore</label>
              <div className="grid grid-cols-2 gap-2">
                {THEME_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p)}
                    className={`flex items-center space-x-2 p-2 rounded-lg border text-[10px] transition-colors ${
                      draft.primaryColor === p.primaryColor
                        ? 'border-brand-primary bg-brand-primary/10'
                        : 'border-brand-border hover:border-brand-textMuted'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: p.primaryColor }} />
                    <span className="truncate text-brand-text">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-brand-textMuted mb-1 block">Colore primario</label>
                <input
                  type="color"
                  value={draft.primaryColor}
                  onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })}
                  className="w-full h-9 rounded-lg cursor-pointer bg-brand-surfaceAlt border border-brand-border"
                />
              </div>
              <div>
                <label className="text-[11px] text-brand-textMuted mb-1 block">Colore secondario</label>
                <input
                  type="color"
                  value={draft.secondaryColor}
                  onChange={(e) => setDraft({ ...draft, secondaryColor: e.target.value })}
                  className="w-full h-9 rounded-lg cursor-pointer bg-brand-surfaceAlt border border-brand-border"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-brand-textMuted mb-1.5 block">Modalità</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDraft({ ...draft, mode: 'dark' })}
                  className={`flex items-center justify-center space-x-1.5 p-2 rounded-lg border text-xs transition-colors ${
                    draft.mode === 'dark' ? 'border-brand-primary bg-brand-primary/10' : 'border-brand-border'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" /><span>Scura</span>
                </button>
                <button
                  onClick={() => setDraft({ ...draft, mode: 'light' })}
                  className={`flex items-center justify-center space-x-1.5 p-2 rounded-lg border text-xs transition-colors ${
                    draft.mode === 'light' ? 'border-brand-primary bg-brand-primary/10' : 'border-brand-border'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" /><span>Chiara</span>
                </button>
              </div>
            </div>
          </div>

          {/* COLONNA DESTRA: anteprima live */}
          <div className="flex flex-col">
            <label className="text-[11px] text-brand-textMuted mb-1.5 block">Anteprima</label>
            <div
              className="flex-1 rounded-xl border border-brand-border overflow-hidden flex flex-col"
              style={{ backgroundColor: draft.mode === 'light' ? '#f8fafc' : '#0f172a' }}
            >
              <div
                className="px-4 py-3 flex items-center space-x-2"
                style={{ backgroundColor: draft.primaryColor }}
              >
                <div className="w-6 h-6 rounded bg-white/20 flex items-center justify-center text-white text-[10px] font-bold">
                  {(draft.logoMark || 'HUB').slice(0, 4).toUpperCase()}
                </div>
                <span className="text-white text-xs font-semibold truncate">
                  {draft.companyName || 'La Tua Azienda'}
                </span>
              </div>
              <div className="p-4 space-y-2 flex-1">
                <div
                  className="rounded-lg p-2.5 text-[10px] max-w-[80%]"
                  style={{
                    backgroundColor: draft.mode === 'light' ? '#e2e8f0' : '#1e293b',
                    color: draft.mode === 'light' ? '#0f172a' : '#f1f5f9'
                  }}
                >
                  Buongiorno, come posso aiutarti oggi?
                </div>
                <div
                  className="rounded-lg p-2.5 text-[10px] max-w-[80%] ml-auto text-white"
                  style={{ backgroundColor: draft.primaryColor }}
                >
                  Mostrami l'esposizione totale dei fidi
                </div>
                <div
                  className="inline-flex items-center space-x-1 rounded-full px-2.5 py-1 text-[9px] text-white mt-1"
                  style={{ backgroundColor: draft.secondaryColor }}
                >
                  <Check className="w-2.5 h-2.5" /><span>Report pronto</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer azioni */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-brand-border">
          <button
            onClick={onBack}
            className="flex items-center space-x-1.5 text-xs text-brand-textMuted hover:text-brand-text transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /><span>Indietro</span>
          </button>
          <button
            onClick={handleConfirm}
            className="flex items-center space-x-2 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors shadow-md"
            style={{ backgroundColor: draft.primaryColor }}
          >
            <span>Entra nel tuo Hub</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
