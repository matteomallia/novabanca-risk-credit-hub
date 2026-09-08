import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Bot, User, Sparkles, AlertTriangle, Database, FileText,
  ChevronDown, Brain, Wrench, CheckCircle2, XCircle, Mail, Loader2
} from 'lucide-react';

// Mostra in tempo reale il ragionamento ReAct (Thought/Action/Observation) mentre
// l'agente lavora: rende visibile e comprensibile il paradigma "Reason + Act"
// richiesto dal progetto, invece di una singola icona di caricamento generica.
const LiveReasoningPanel = ({ liveSteps }) => {
  if (!liveSteps || liveSteps.length === 0) {
    return (
      <div className="flex items-center space-x-2 bg-brand-surfaceAlt/60 px-3 py-2 rounded-xl border border-brand-border/50">
        <span className="w-1.5 h-1.5 bg-brand-secondary rounded-full animate-ping"></span>
        <span className="text-[11px] text-brand-textMuted">L'agente sta ragionando...</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[85%] bg-brand-surfaceAlt/60 border border-brand-border/50 rounded-xl p-3 space-y-1.5">
      {liveSteps.map((step, i) => (
        <div key={i} className="flex items-start space-x-2 text-[11px]">
          {step.type === 'thought' && (
            <>
              <Brain className="w-3.5 h-3.5 text-brand-secondary mt-0.5 shrink-0" />
              <div className="text-brand-textMuted">
                <span className="text-brand-secondary font-medium">Thought: </span>
                {step.thought || '...'}
                {step.tool && (
                  <div className="text-brand-textMuted mt-0.5">
                    <Wrench className="w-3 h-3 inline mr-1" />
                    Action: <span className="font-mono text-brand-primary">{step.tool}</span>
                  </div>
                )}
              </div>
            </>
          )}
          {step.type === 'observation' && (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-brand-primary mt-0.5 shrink-0" />
              <div className="text-brand-textMuted">
                <span className="text-brand-primary font-medium">Observation ({step.tool}): </span>
                <span className="line-clamp-2">{step.output}</span>
              </div>
            </>
          )}
          {step.type === 'tool_error' && (
            <>
              <XCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
              <div className="text-rose-300">
                <span className="font-medium">Errore tool ({step.tool}): </span>
                {step.error}
              </div>
            </>
          )}
        </div>
      ))}
      <div className="flex items-center space-x-2 pt-1 text-[11px] text-brand-textMuted">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Composizione della risposta finale...</span>
      </div>
    </div>
  );
};

// Badge cliccabili con le fonti documentali RAG effettivamente usate dall'agente,
// per trasparenza: l'utente vede subito da quale documento arriva l'informazione.
const SourceBadges = ({ sources }) => {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((src, i) => (
        <span
          key={i}
          title={`Fonte: ${src}`}
          className="inline-flex items-center gap-1 bg-blue-950/40 border border-blue-800/50 text-blue-300 text-[10px] px-2 py-1 rounded-full"
        >
          <FileText className="w-3 h-3" />
          {src}
        </span>
      ))}
    </div>
  );
};

// Card di conferma umana prima dell'invio effettivo dell'email executive
// (guardrail human-in-the-loop): l'agente prepara solo la bozza, l'invio reale
// parte solo se l'utente clicca "Conferma invio".
const PendingEmailCard = ({ pendingEmail, onResolve }) => {
  if (!pendingEmail) return null;

  if (pendingEmail.resolved) {
    return (
      <div className={`mt-3 pt-2 border-t border-brand-border/60 flex items-center space-x-2 text-[11px] ${
        pendingEmail.success ? 'text-emerald-400' : 'text-rose-400'
      }`}>
        {pendingEmail.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
        <span>{pendingEmail.message}</span>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-brand-border/60 bg-brand-secondary/10 border border-brand-secondary/40 rounded-lg p-3 space-y-2">
      <div className="flex items-center space-x-1.5 text-[11px] text-brand-secondary font-semibold">
        <Mail className="w-3.5 h-3.5" />
        <span>Bozza report pronta — richiede la tua conferma</span>
      </div>
      <div className="text-[10px] text-brand-textMuted">
        <span className="text-brand-textMuted">A:</span> {pendingEmail.to} &nbsp;·&nbsp;
        <span className="text-brand-textMuted">Oggetto:</span> {pendingEmail.subject}
      </div>
      <div className="text-[10px] text-brand-textMuted italic">{pendingEmail.preview}...</div>
      <div className="flex space-x-2 pt-1">
        <button
          disabled={pendingEmail.resolving}
          onClick={() => onResolve(pendingEmail.id, true)}
          className="flex items-center space-x-1 bg-brand-primary hover:bg-brand-primary disabled:opacity-50 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {pendingEmail.resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
          <span>Conferma invio</span>
        </button>
        <button
          disabled={pendingEmail.resolving}
          onClick={() => onResolve(pendingEmail.id, false)}
          className="flex items-center space-x-1 bg-brand-border hover:bg-slate-600 disabled:opacity-50 text-brand-text text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          <XCircle className="w-3 h-3" />
          <span>Annulla</span>
        </button>
      </div>
    </div>
  );
};

// Chip di domande suggerite, mostrate solo sotto il primo messaggio (il benvenuto):
// aiutano l'utente a scoprire subito cosa chiedere, riducendo le domande generiche
// che l'agente non è progettato per gestire bene (es. "cosa puoi fare" testuale).
const SUGGESTED_PROMPTS = [
  "Qual è l'esposizione totale dei fidi erogati?",
  "Quali sono le soglie DTI e LTV per i mutui?",
  "Calcola il tasso di default per filiale",
  "Cosa prevede il manuale NPL per i ritardi oltre 90 giorni?"
];

const SuggestedPrompts = ({ onSelect }) => (
  <div className="flex flex-wrap gap-1.5 mt-3 pl-11">
    {SUGGESTED_PROMPTS.map((p, i) => (
      <button
        key={i}
        onClick={() => onSelect(p)}
        className="text-[10.5px] bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/30 px-2.5 py-1.5 rounded-full transition-colors"
      >
        {p}
      </button>
    ))}
  </div>
);

export const ChatBox = ({ messages, onSendMessage, onSelectChart, isLoading, liveSteps, onResolvePendingEmail }) => {
  const [inputMessage, setInputMessage] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, liveSteps]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || isLoading) return;
    onSendMessage(inputMessage);
    setInputMessage('');
    setShowDropdown(false);
  };

  // Mappa completa delle 4 Tabelle DB e dei 3 Documenti RAG
  const systemResources = [
    {
      category: "Tabelle Database Relazionale (SQLite)",
      icon: <Database className="w-3.5 h-3.5 text-brand-primary" />,
      items: [
        { label: "T_CLIENTI (Anagrafica & Redditi)", prompt: "Mostrami la struttura e un'anteprima dei dati della tabella T_CLIENTI" },
        { label: "T_PRATICHE_FIDO (Richieste Mutui & Fidi)", prompt: "Mostrami la struttura e un'anteprima dei record della tabella T_PRATICHE_FIDO" },
        { label: "T_FILIALI (Rete Territoriale & Aree)", prompt: "Mostrami l'elenco delle filiali e la loro area geografica dalla tabella T_FILIALI" },
        { label: "T_PERFORMANCE_AMORT (Storico Rate & Default)", prompt: "Calcola la percentuale di default per filiale dalla tabella T_PERFORMANCE_AMORT" }
      ]
    },
    {
      category: "Documenti Knowledge Base Normativa (RAG)",
      icon: <FileText className="w-3.5 h-3.5 text-brand-primary" />,
      items: [
        { label: "Policy_Erogazione_Credito_2026.pdf", prompt: "Quali sono le soglie DTI e LTV massime nel documento Policy_Erogazione_Credito_2026.pdf?" },
        { label: "Manuale_Gestione_NPL_e_Crediti_Deteriorati.txt", prompt: "Cosa stabilisce il Manuale_Gestione_NPL per i ritardi superiori ai 90 giorni?" },
        { label: "FAQ_Operative_Consulenti_Risk.md", prompt: "Quali sono le indicazioni sulle soglie di usura e MiFID II nel file FAQ_Operative_Consulenti_Risk.md?" }
      ]
    },
    {
      category: "Azioni Esecutive",
      icon: <Mail className="w-3.5 h-3.5 text-brand-secondary" />,
      items: [
        { label: "Prepara Report Executive via Email", prompt: "Prepara un report executive di sintesi sull'esposizione creditizia totale e inviamelo via email" }
      ]
    }
  ];

  const handleSelectResource = (promptText) => {
    setInputMessage(promptText);
    setShowDropdown(false);
  };

  return (
    <div className="flex flex-col h-full bg-brand-surface border border-brand-surfaceAlt rounded-xl overflow-hidden shadow-xl relative">
      {/* Stream dei Messaggi Chat */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <React.Fragment key={msg.id}>
          <div
            className={`flex items-start space-x-3 ${
              msg.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''
            }`}
          >
            <div
              className={`p-2 rounded-xl flex items-center justify-center shadow-md ${
                msg.sender === 'user'
                  ? 'bg-brand-primary text-white'
                  : msg.isError
                  ? 'bg-rose-900/80 text-rose-200 border border-rose-700'
                  : 'bg-brand-surfaceAlt text-brand-primary border border-brand-border'
              }`}
            >
              {msg.sender === 'user' ? (
                <User className="w-4 h-4" />
              ) : msg.isError ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <Bot className="w-4 h-4" />
              )}
            </div>

            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                msg.sender === 'user'
                  ? 'bg-brand-primary text-white rounded-tr-none font-medium'
                  : msg.isError
                  ? 'bg-rose-950/60 border border-rose-800/80 text-rose-200 rounded-tl-none'
                  : 'bg-brand-surfaceAlt/90 border border-brand-border/80 text-brand-text rounded-tl-none'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.text}</div>

              <SourceBadges sources={msg.sources} />

              {/* Pulsante Attivazione Canvas per i Grafici */}
              {msg.chartUrl && (
                <div className="mt-3 pt-2 border-t border-brand-border/60">
                  <button
                    onClick={() => onSelectChart(msg.chartUrl, msg.text)}
                    className="flex items-center space-x-2 bg-brand-primary/15 hover:bg-brand-primary/25 text-brand-primary border border-brand-primary/40 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-200 group cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-brand-primary group-hover:scale-110 transition-transform" />
                    <span>Visualizza Grafico nell'Interactive Canvas</span>
                  </button>
                </div>
              )}

              <PendingEmailCard
                pendingEmail={msg.pendingEmail}
                onResolve={(emailId, approved) => onResolvePendingEmail(msg.id, emailId, approved)}
              />

              <div
                className={`text-[9px] mt-1.5 text-right ${
                  msg.sender === 'user' ? 'text-blue-100/70' : 'text-brand-textMuted'
                }`}
              >
                {msg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
          {idx === 0 && messages.length === 1 && (
            <SuggestedPrompts onSelect={(p) => setInputMessage(p)} />
          )}
          </React.Fragment>
        ))}

        {isLoading && (
          <div className="flex items-start space-x-3 text-brand-textMuted text-xs pl-2">
            <div className="p-2 bg-brand-surfaceAlt rounded-xl border border-brand-border text-brand-primary">
              <Bot className="w-4 h-4 animate-bounce" />
            </div>
            <LiveReasoningPanel liveSteps={liveSteps} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Menu a Tendina Fluttuante per Selezione Rapida Risorse */}
      {showDropdown && (
        <div className="absolute bottom-16 left-4 right-4 bg-brand-surface border border-brand-border rounded-xl shadow-2xl p-3 z-30 max-h-72 overflow-y-auto backdrop-blur-lg">
          <div className="flex items-center justify-between pb-2 border-b border-brand-surfaceAlt mb-2">
            <span className="text-[11px] font-semibold text-brand-primary uppercase tracking-wider">
              Seleziona Risorsa Backend o Tabella DB
            </span>
            <button
              onClick={() => setShowDropdown(false)}
              className="text-xs text-brand-textMuted hover:text-brand-textMuted"
            >
              Chiudi ✕
            </button>
          </div>

          <div className="space-y-3">
            {systemResources.map((res, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center space-x-1.5 text-[10px] font-medium text-brand-textMuted">
                  {res.icon}
                  <span>{res.category}</span>
                </div>
                <div className="grid grid-cols-1 gap-1 pl-2">
                  {res.items.map((item, j) => (
                    <button
                      key={j}
                      onClick={() => handleSelectResource(item.prompt)}
                      className="text-left text-xs bg-brand-surfaceAlt/60 hover:bg-brand-surfaceAlt text-brand-text p-2 rounded-lg border border-brand-border/50 transition-colors flex items-center justify-between group"
                    >
                      <span className="font-mono text-brand-primary">{item.label}</span>
                      <span className="text-[10px] text-brand-textMuted group-hover:text-brand-textMuted">Inserisci Prompt ➔</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Barra di Input con Pulsante Esplora Risorse */}
      <form onSubmit={handleSubmit} className="p-3 bg-brand-bg border-t border-brand-surfaceAlt flex items-center space-x-2">
        <button
          type="button"
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center space-x-1.5 bg-brand-surfaceAlt hover:bg-brand-border text-brand-textMuted border border-brand-border px-3 py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
          title="Mostra Tabelle DB e Documenti KB"
        >
          <Database className="w-3.5 h-3.5 text-brand-primary" />
          <span className="hidden sm:inline font-medium">Risorse Backend</span>
          <ChevronDown className="w-3.5 h-3.5 text-brand-textMuted" />
        </button>

        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Fai una domanda o seleziona una tabella dal menu Risorse..."
          disabled={isLoading}
          className="flex-1 bg-brand-surface border border-brand-surfaceAlt rounded-xl px-4 py-2.5 text-xs text-brand-text placeholder-brand-textMuted focus:outline-none focus:border-brand-primary transition-colors disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={isLoading || !inputMessage.trim()}
          className="bg-brand-primary hover:bg-brand-primary text-white p-2.5 rounded-xl transition-all duration-200 disabled:opacity-40 shadow-lg shadow-brand-primary/30 cursor-pointer"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
