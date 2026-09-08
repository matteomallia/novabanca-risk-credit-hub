import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { TrendingUp, Newspaper, RefreshCw, ShieldCheck, Info, X, Database, FileText, Mail, Settings2, Palette, LogOut } from 'lucide-react';
import { apiUrl } from '../config';

// Modal informativo "Cosa posso fare": risponde a livello di UI alle domande di
// capacità generiche (es. "Cos'altro puoi fare?"), senza dover interpellare l'LLM
// per un'informazione statica e sempre uguale.
const CapabilitiesModal = ({ onClose }) => (
  <div className="fixed inset-0 z-50 bg-brand-bg/80 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-brand-surface border border-brand-surfaceAlt rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
      <div className="bg-brand-primary px-5 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-white">
          <ShieldCheck className="w-5 h-5" />
          <h3 className="font-semibold text-sm">Cosa può fare l'Hub Risk & Credit</h3>
        </div>
        <button onClick={onClose} className="text-white/80 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex items-start space-x-3">
          <div className="p-2 bg-brand-primary/15 border border-brand-primary/30 rounded-lg text-brand-primary">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-brand-text">Consultazione Normativa (RAG)</p>
            <p className="text-[11px] text-brand-textMuted mt-0.5">
              Policy di erogazione credito (DTI/LTV), manuale di gestione NPL, FAQ su usura e MiFID II.
            </p>
          </div>
        </div>
        <div className="flex items-start space-x-3">
          <div className="p-2 bg-brand-secondary/15 border border-brand-secondary/30 rounded-lg text-brand-secondary">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-brand-text">Analisi Dati & Grafici</p>
            <p className="text-[11px] text-brand-textMuted mt-0.5">
              Query su clienti, pratiche di fido, filiali e performance di rimborso, con grafici generati al volo.
            </p>
          </div>
        </div>
        <div className="flex items-start space-x-3">
          <div className="p-2 bg-emerald-500/15 border border-emerald-500/30 rounded-lg text-emerald-400">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-brand-text">Report Executive via Email</p>
            <p className="text-[11px] text-brand-textMuted mt-0.5">
              Prepara una bozza di report: l'invio reale parte solo dopo la tua conferma esplicita in chat.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const TopBar = ({ onClearChat, onOpenAgentSettings, agentConfig, theme, session, onLogout, onOpenWizard }) => {
  const [marketData, setMarketData] = useState({
    ticker: [
      { symbol: 'FTSE MIB', price: '34.850,20', change: '+0.42%' },
      { symbol: 'ISP.MI', price: '3.68 EUR', change: '+0.85%' },
      { symbol: 'EUR/USD', price: '1.0885', change: '-0.12%' },
      { symbol: 'BTP 10Y Yield', price: '3.54%', change: '-0.03%' }
    ],
    news: []
  });
  const [showCapabilities, setShowCapabilities] = useState(false);

  // Fetching periodico delle notizie e dei dati di mercato
  useEffect(() => {
    const fetchMarketNews = async () => {
      try {
        const response = await axios.get(apiUrl('/api/market-news'));
        if (response.data) {
          setMarketData((prev) => ({
            ticker: response.data.ticker || prev.ticker,
            news: response.data.news || []
          }));
        }
      } catch (err) {
        console.warn('[TopBar Warning] Impossibile aggiornare i dati di mercato:', err.message);
      }
    };

    fetchMarketNews();
    // Refresh ogni 60 secondi
    const interval = setInterval(fetchMarketNews, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleReset = () => {
    if (typeof onClearChat === 'function') {
      onClearChat();
    }
  };

  return (
    <header className="bg-brand-surface border-b border-brand-surfaceAlt text-brand-text shadow-md">
      {/* 1. Header Principale con Branding ISP */}
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="bg-brand-primary p-2 rounded-lg flex items-center justify-center text-white min-w-[2.5rem]">
            {theme?.logoMark ? (
              <span className="font-bold text-xs">{theme.logoMark}</span>
            ) : (
              <ShieldCheck className="w-6 h-6" />
            )}
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-brand-text flex items-center gap-2">
              {(theme?.companyName || 'INTESA SANPAOLO').toUpperCase()}
              <span className="text-xs bg-brand-secondary/15 text-brand-secondary border border-brand-secondary/40 font-semibold px-2 py-0.5 rounded-full">
                Risk & Credit Hub
              </span>
            </h1>
            <p className="text-xs text-brand-textMuted">
              Piattaforma Agentica per l'Analisi del Rischio Creditizio e Consultazione Normativa
              {session?.name && <span className="text-brand-textMuted"> · {session.name} ({session.role})</span>}
            </p>
          </div>
        </div>

        {/* Azioni Rapide */}
        <div className="flex items-center space-x-2">
          <button
            onClick={onOpenAgentSettings}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-brand-secondary bg-brand-secondary/10 hover:bg-brand-secondary/20 rounded-md border border-brand-secondary/30 transition-colors cursor-pointer"
            title="Configura modello, tool e knowledge base"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Impostazioni Agente</span>
            {agentConfig?.model && (
              <span className="hidden sm:inline text-[10px] text-brand-secondary/70 font-mono">· {agentConfig.model}</span>
            )}
          </button>
          <button
            onClick={() => setShowCapabilities(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-brand-primary bg-brand-primary/10 hover:bg-brand-primary/20 rounded-md border border-brand-primary/30 transition-colors cursor-pointer"
            title="Cosa può fare questo assistente"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Cosa posso fare</span>
          </button>
          <button
            onClick={handleReset}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-brand-textMuted bg-brand-surfaceAlt hover:bg-brand-border hover:text-brand-text rounded-md border border-brand-border transition-colors cursor-pointer"
            title="Azzera la sessione conversazionale"
          >
            <RefreshCw className="w-3.5 h-3.5 text-brand-secondary" />
            <span>Nuova Sessione</span>
          </button>
          {onOpenWizard && (
            <button
              onClick={onOpenWizard}
              className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-brand-textMuted bg-brand-surfaceAlt hover:bg-brand-border hover:text-brand-text rounded-md border border-brand-border transition-colors cursor-pointer"
              title="Cambia colori, logo e modalità chiara/scura"
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Tema</span>
            </button>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 rounded-md border border-rose-500/30 transition-colors cursor-pointer"
              title="Esci e torna alla pagina iniziale"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Esci</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Ticker Borsa & Market News Banner (Scorrimento Orizzontale) */}
      <div className="bg-brand-bg border-t border-brand-surfaceAlt py-1.5 px-4 text-xs overflow-hidden flex items-center">
        <div className="flex items-center space-x-2 text-brand-primary font-semibold shrink-0 pr-4 border-r border-brand-surfaceAlt">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>BORSA ITALIANA</span>
        </div>

        {/* Ticker Items */}
        <div className="flex items-center space-x-6 overflow-x-auto no-scrollbar whitespace-nowrap px-4 text-brand-textMuted">
          {marketData.ticker.map((item, idx) => {
            const isPositive = item.change && item.change.startsWith('+');
            return (
              <div key={idx} className="flex items-center space-x-2">
                <span className="font-medium text-brand-text">{item.symbol}:</span>
                <span className="font-mono text-brand-text">{item.price}</span>
                <span className={`font-mono font-semibold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {item.change}
                </span>
              </div>
            );
          })}

          {/* Notizie Finanziarie in Scorrimento */}
          {marketData.news && marketData.news.length > 0 && (
            <div className="flex items-center space-x-4 border-l border-brand-surfaceAlt pl-4 text-brand-textMuted">
              <Newspaper className="w-3.5 h-3.5 text-brand-secondary shrink-0" />
              {marketData.news.slice(0, 2).map((n, i) => (
                <span key={i} className="truncate max-w-md italic">
                  "{n.title}" <span className="text-brand-textMuted font-sans">({n.source})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCapabilities && <CapabilitiesModal onClose={() => setShowCapabilities(false)} />}
    </header>
  );
};
