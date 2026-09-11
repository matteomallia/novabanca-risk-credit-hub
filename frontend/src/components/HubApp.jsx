import React, { useState } from 'react';
import { TopBar } from './TopBar';
import { ChatBox } from './ChatBox';
import { InteractiveCanvas } from './InteractiveCanvas';
import { KpiCards } from './KpiCards';
import { AgentSettingsPanel } from './AgentSettingsPanel';
import { useChat } from '../hooks/useChat';

// Configurazione di default dell'agente: tutti i tool abilitati, modello
// economico, tono tecnico da Risk Officer. L'utente può cambiarla dal pannello
// Impostazioni; ogni nuovo messaggio invierà al backend la configurazione attuale.
const DEFAULT_AGENT_CONFIG = {
  model: 'gpt-4o-mini',
  enabledTools: ['query_knowledge_base', 'execute_data_analytics', 'fetch_market_news', 'send_executive_report'],
  persona: 'risk_officer'
};

// L'applicazione vera e propria (post-login/post-wizard). Riceve il tema e la
// sessione mock dal router in App.jsx, cosi' la TopBar può mostrare il
// branding corretto (NVB di default, oppure quello scelto nel wizard).
export default function HubApp({ theme, session, onLogout, onOpenWizard }) {
  const [agentConfig, setAgentConfig] = useState(DEFAULT_AGENT_CONFIG);
  const [showAgentSettings, setShowAgentSettings] = useState(false);

  const {
    messages,
    sendMessage,
    resetChat,
    isLoading,
    liveSteps,
    resolvePendingEmail
  } = useChat();

  const [activeChartUrl, setActiveChartUrl] = useState(null);
  const [activeSummaryText, setActiveSummaryText] = useState('');

  // Funzione per resettare completamente la sessione (Chat e Canvas)
  const handleClearChat = () => {
    if (resetChat) {
      resetChat();
    }
    setActiveChartUrl(null);
    setActiveSummaryText('');
  };

  const handleSelectChart = (url, summary) => {
    setActiveChartUrl(url);
    setActiveSummaryText(summary);
  };

  const handleSendMessage = async (text) => {
    const result = await sendMessage(text, agentConfig);
    if (result && result.chartUrl) {
      setActiveChartUrl(result.chartUrl);
      setActiveSummaryText(result.reply);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-brand-bg text-brand-text font-sans overflow-hidden">
      <TopBar
        onClearChat={handleClearChat}
        onOpenAgentSettings={() => setShowAgentSettings(true)}
        agentConfig={agentConfig}
        theme={theme}
        session={session}
        onLogout={onLogout}
        onOpenWizard={onOpenWizard}
      />

      {/* Dashboard KPI Executive: sempre visibile, indipendente dalla chat */}
      <KpiCards />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 overflow-hidden">
        <div className="lg:col-span-7 h-full overflow-hidden">
          <ChatBox
            isLoading={isLoading}
            liveSteps={liveSteps}
            messages={messages}
            onSelectChart={handleSelectChart}
            onSendMessage={handleSendMessage}
            onResolvePendingEmail={resolvePendingEmail}
          />
        </div>
        <div className="lg:col-span-5 h-full overflow-hidden">
          <InteractiveCanvas
            chartUrl={activeChartUrl}
            summaryText={activeSummaryText}
          />
        </div>
      </div>

      {showAgentSettings && (
        <AgentSettingsPanel
          agentConfig={agentConfig}
          onChangeConfig={setAgentConfig}
          onClose={() => setShowAgentSettings(false)}
        />
      )}
    </div>
  );
}
