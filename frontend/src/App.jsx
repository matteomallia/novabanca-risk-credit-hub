import React, { useEffect, useState } from 'react';
import { LandingPage } from './components/LandingPage';
import { OnboardingWizard } from './components/OnboardingWizard';
import HubApp from './components/HubApp';
import { DEFAULT_THEME, applyThemeToDocument, loadTheme, saveTheme, loadSession, saveSession, clearSession } from './theme';

// Router di primo livello a 3 stati:
// 'landing'  -> LandingPage (Accedi / Configura il tuo Hub)
// 'wizard'   -> OnboardingWizard (personalizzazione white-label)
// 'app'      -> HubApp (l'applicazione vera e propria)
export default function App() {
  const [view, setView] = useState('landing');
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [session, setSession] = useState(null);

  // Al primo caricamento: se esiste già una sessione salvata (utente aveva
  // già fatto accesso in precedenza), applica il tema salvato e va dritto
  // all'app, senza rimostrare la landing page.
  useEffect(() => {
    const savedTheme = loadTheme();
    const savedSession = loadSession();
    setTheme(savedTheme);
    applyThemeToDocument(savedTheme);
    if (savedSession) {
      setSession(savedSession);
      setView('app');
    }
  }, []);

  const handleEnterDefault = (userSession) => {
    // Percorso "Accedi": tema ufficiale NovaBanca di default
    setTheme(DEFAULT_THEME);
    applyThemeToDocument(DEFAULT_THEME);
    saveTheme(DEFAULT_THEME);
    setSession(userSession);
    saveSession(userSession);
    setView('app');
  };

  const handleConfirmWizard = (customTheme) => {
    setTheme(customTheme);
    applyThemeToDocument(customTheme);
    saveTheme(customTheme);
    const userSession = { name: 'Ospite', role: 'Amministratore White-Label' };
    setSession(userSession);
    saveSession(userSession);
    setView('app');
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
    setView('landing');
  };

  if (view === 'wizard') {
    return <OnboardingWizard onConfirm={handleConfirmWizard} onBack={() => setView('landing')} />;
  }

  if (view === 'app' && session) {
    return (
      <HubApp
        theme={theme}
        session={session}
        onLogout={handleLogout}
        onOpenWizard={() => setView('wizard')}
      />
    );
  }

  return (
    <LandingPage
      onEnterDefault={handleEnterDefault}
      onOpenWizard={() => setView('wizard')}
    />
  );
}
