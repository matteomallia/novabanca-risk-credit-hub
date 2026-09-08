import React, { useState } from 'react';
import { ShieldCheck, LogIn, Palette, ArrowRight, Building2, User } from 'lucide-react';

const ROLES = ['Risk Officer', 'Manager', 'Analista Credito', 'Revisore'];

// Landing page d'ingresso: due percorsi distinti.
// - "Accedi": entra subito nell'Hub con il branding ufficiale Intesa Sanpaolo.
// - "Configura il tuo Hub": apre il wizard di personalizzazione white-label
//   (colori, logo testuale, nome azienda, dark/light) prima di entrare.
//
// NOTA: "Accedi" è un login dimostrativo (nome + ruolo), NON un'autenticazione
// reale — non esiste verifica password né un database utenti nel backend.
export const LandingPage = ({ onEnterDefault, onOpenWizard }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState(ROLES[0]);

  const handleLogin = (e) => {
    e.preventDefault();
    onEnterDefault({ name: name.trim() || 'Ospite', role });
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text flex flex-col items-center justify-center p-6">
      {/* Logo / Mark ufficiale — resta sempre ISP qui, indipendentemente dal tema scelto dopo */}
      <div className="flex flex-col items-center mb-10 text-center">
        <div className="bg-isp-blue p-4 rounded-2xl shadow-lg shadow-isp-blue/30 mb-4">
          <ShieldCheck className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">INTESA SANPAOLO</h1>
        <p className="text-sm text-brand-textMuted mt-1">Risk & Credit Intelligence Hub</p>
      </div>

      {/* Due box affiancate */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-3xl">
        {/* BOX SINISTRA: Accedi */}
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 flex flex-col shadow-xl">
          <div className="flex items-center space-x-2 mb-1">
            <LogIn className="w-5 h-5 text-isp-blue" />
            <h2 className="font-semibold text-base">Accedi</h2>
          </div>
          <p className="text-xs text-brand-textMuted mb-5">
            Entra subito nell'Hub con il branding ufficiale Intesa Sanpaolo.
          </p>

          <form onSubmit={handleLogin} className="flex flex-col space-y-3 flex-1">
            <div>
              <label className="text-[11px] text-brand-textMuted flex items-center space-x-1 mb-1">
                <User className="w-3 h-3" /><span>Nome</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="es. Mario Rossi"
                className="w-full bg-brand-surfaceAlt border border-brand-border rounded-lg px-3 py-2 text-xs text-brand-text placeholder-brand-textMuted focus:outline-none focus:border-isp-blue transition-colors"
              />
            </div>
            <div>
              <label className="text-[11px] text-brand-textMuted flex items-center space-x-1 mb-1">
                <Building2 className="w-3 h-3" /><span>Ruolo</span>
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-brand-surfaceAlt border border-brand-border rounded-lg px-3 py-2 text-xs text-brand-text focus:outline-none focus:border-isp-blue transition-colors"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="flex-1" />

            <button
              type="submit"
              className="flex items-center justify-center space-x-2 bg-isp-blue hover:bg-isp-blue/90 text-white text-sm font-medium py-2.5 rounded-lg transition-colors shadow-md shadow-isp-blue/20"
            >
              <span>Accedi all'Hub</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-[10px] text-brand-textMuted text-center">
              Accesso dimostrativo: nessuna password richiesta.
            </p>
          </form>
        </div>

        {/* BOX DESTRA: Configura il tuo Hub */}
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 flex flex-col shadow-xl">
          <div className="flex items-center space-x-2 mb-1">
            <Palette className="w-5 h-5 text-isp-orange" />
            <h2 className="font-semibold text-base">Configura il tuo Hub</h2>
          </div>
          <p className="text-xs text-brand-textMuted mb-5">
            Personalizza colori, nome e logo per simulare il riuso della piattaforma
            in un altro reparto o azienda (white-label).
          </p>

          <div className="flex-1 flex flex-col justify-center items-center text-center space-y-4 py-4">
            <div className="grid grid-cols-3 gap-2">
              <span className="w-8 h-8 rounded-full bg-isp-blue" title="Blu ISP" />
              <span className="w-8 h-8 rounded-full bg-emerald-600" title="Emerald Tech" />
              <span className="w-8 h-8 rounded-full bg-rose-700" title="Crimson Finance" />
            </div>
            <p className="text-[11px] text-brand-textMuted max-w-[220px]">
              Scegli un preset o un colore libero, il nome dell'azienda e la modalità chiara/scura.
            </p>
          </div>

          <button
            onClick={onOpenWizard}
            className="flex items-center justify-center space-x-2 bg-isp-orange hover:bg-isp-orange/90 text-white text-sm font-medium py-2.5 rounded-lg transition-colors shadow-md shadow-isp-orange/20"
          >
            <span>Apri il Wizard di Personalizzazione</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
