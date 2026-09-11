import { useState, useCallback } from 'react';
import { apiUrl, resolveAssetUrl } from '../config';

const ts = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const useChat = () => {
  const initialWelcomeMessage = {
    id: uid(),
    sender: 'bot',
    text: "Benvenuto nel Risk & Credit Intelligence Hub di NovaBanca. Sono il tuo assistente agentico. Come posso supportarti oggi nelle analisi di credito o nella consultazione normativa?",
    timestamp: ts()
  };

  const [messages, setMessages] = useState([initialWelcomeMessage]);
  const [isLoading, setIsLoading] = useState(false);
  // Passi di ragionamento ricevuti in streaming durante l'elaborazione corrente
  // (Thought/Action/Observation del ReAct Agent), mostrati live in ChatBox.
  const [liveSteps, setLiveSteps] = useState([]);

  const resetChat = () => {
    console.log("[useChat]: Azzeramento sessione conversazionale in corso...");
    setMessages([{ ...initialWelcomeMessage, id: uid(), timestamp: ts() }]);
    setLiveSteps([]);
  };

  /**
   * Invio messaggio all'Orchestratore Backend Node.js, in streaming (NDJSON):
   * ogni riga della risposta è un evento JSON {type, ...}. Aggiorniamo liveSteps
   * man mano che arrivano i Thought/Observation, e costruiamo il messaggio finale
   * del bot quando arriva l'evento 'final'.
   */
  const sendMessage = async (messageText, agentConfig) => {
    if (!messageText.trim()) return null;

    const userMessage = { id: uid(), sender: 'user', text: messageText, timestamp: ts() };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setLiveSteps([]);

    // Storico conversazionale reale: includiamo anche l'eventuale query SQL usata
    // in un turno bot precedente, per abilitare il drill-down conversazionale
    // (es. "e per l'area Nord?") lato prompt dell'agente.
    const conversationHistory = messages
      .filter((m) => !m.isError)
      .slice(-10)
      .map((m) => ({
        role: m.sender === 'user' ? 'human' : 'ai',
        content: m.text,
        sql: m.sql || undefined
      }));

    let finalPayload = null;

    try {
      const response = await fetch(apiUrl('/api/chat/stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, chat_history: conversationHistory, agentConfig })
      });

      if (!response.ok || !response.body) {
        throw new Error("Errore nella comunicazione con il server.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Protocollo NDJSON: una riga = un evento JSON completo
        const lines = buffer.split('\n');
        buffer = lines.pop(); // ultima riga potenzialmente incompleta, resta nel buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch (e) {
            continue;
          }

          if (event.type === 'thought' || event.type === 'observation' || event.type === 'tool_error') {
            setLiveSteps((prev) => [...prev, event]);
          } else if (event.type === 'final') {
            finalPayload = event;
          } else if (event.type === 'error') {
            throw new Error(event.detail || event.error || 'Errore agentico');
          }
        }
      }

      const botMessage = {
        id: uid(),
        sender: 'bot',
        text: finalPayload?.reply || "Analisi completata con successo.",
        chartUrl: resolveAssetUrl(finalPayload?.chartUrl) || null,
        sql: finalPayload?.sql || null,
        sources: finalPayload?.sources || [],
        agentMeta: finalPayload?.agentMeta || null,
        pendingEmail: finalPayload?.pendingEmail
          ? { ...finalPayload.pendingEmail, resolved: false }
          : null,
        timestamp: ts()
      };

      setMessages((prev) => [...prev, botMessage]);
      setIsLoading(false);
      setLiveSteps([]);

      return { reply: botMessage.text, chartUrl: botMessage.chartUrl };

    } catch (error) {
      console.error("[useChat Error]:", error);
      const errorMessage = {
        id: uid(),
        sender: 'bot',
        text: `⚠️ Errore di comunicazione con l'Orchestratore Backend.\n${error.message ? `Dettaglio: ${error.message}` : ''}\nRiprova con una nuova richiesta.`,
        isError: true,
        timestamp: ts()
      };
      setMessages((prev) => [...prev, errorMessage]);
      setIsLoading(false);
      setLiveSteps([]);
      return null;
    }
  };

  /**
   * Guardrail email: chiamato quando l'utente clicca "Conferma invio" o "Annulla"
   * sulla card di anteprima report mostrata in chat. Aggiorna il messaggio bot
   * corrispondente con l'esito, senza dover ricaricare la conversazione.
   */
  const resolvePendingEmail = useCallback(async (messageId, emailId, approved) => {
    setMessages((prev) => prev.map((m) => (
      m.id === messageId && m.pendingEmail
        ? { ...m, pendingEmail: { ...m.pendingEmail, resolving: true } }
        : m
    )));

    try {
      const res = await fetch(apiUrl('/api/confirm-email'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, approved })
      });
      const data = await res.json();

      setMessages((prev) => prev.map((m) => (
        m.id === messageId && m.pendingEmail
          ? {
              ...m,
              pendingEmail: {
                ...m.pendingEmail,
                resolved: true,
                resolving: false,
                success: data.success,
                sent: data.sent,
                message: data.message
              }
            }
          : m
      )));
    } catch (error) {
      setMessages((prev) => prev.map((m) => (
        m.id === messageId && m.pendingEmail
          ? {
              ...m,
              pendingEmail: {
                ...m.pendingEmail,
                resolved: true,
                resolving: false,
                success: false,
                message: "Errore di comunicazione durante la conferma."
              }
            }
          : m
      )));
    }
  }, []);

  return {
    messages,
    sendMessage,
    resetChat,
    isLoading,
    liveSteps,
    resolvePendingEmail
  };
};
