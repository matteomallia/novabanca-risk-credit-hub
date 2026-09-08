/**
 * Validatori puri per la configurazione dell'agente (modello LLM, tool
 * abilitati, persona). Estratti in un modulo separato da reactAgent.js
 * per essere testabili in isolamento, senza dover istanziare un vero
 * ChatOpenAI o un vero AgentExecutor.
 *
 * Principio di sicurezza: nessuno di questi valori viene MAI passato al
 * modello/ai tool senza prima essere validato contro una whitelist esplicita.
 */

const AGENT_MODELS = [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini — veloce ed economico (default)' },
    { id: 'gpt-4o', label: 'GPT-4o — più capace, risposte più accurate' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini — bilanciato' }
];
const DEFAULT_MODEL = 'gpt-4o-mini';

const AGENT_TOOLS_META = [
    { id: 'query_knowledge_base', label: 'Consultazione Normativa (RAG)' },
    { id: 'execute_data_analytics', label: 'Analisi Dati & Grafici (SQL)' },
    { id: 'fetch_market_news', label: 'Notizie di Mercato (FTSE MIB)' },
    { id: 'send_executive_report', label: 'Preparazione Report Executive via Email' }
];

const AGENT_PERSONAS = {
    risk_officer: {
        label: 'Risk Officer — tecnico e dettagliato',
        instructions: `Adotta un registro tecnico da Risk Officer: cita sempre numeri precisi, percentuali, soglie normative, nomi di tabelle/colonne e fonti documentali usate. Le risposte possono essere lunghe e articolate quanto serve per essere esaustive.`
    },
    executive_summary: {
        label: 'Sintesi Executive — breve e diretto',
        instructions: `Adotta un registro sintetico da executive summary per il management: massimo 4-5 frasi, evidenzia solo l'insight principale e l'eventuale azione consigliata. Evita dettagli tecnici come nomi di tabelle, colonne o query SQL: traduci sempre tutto in linguaggio di business.`
    }
};
const DEFAULT_PERSONA = 'risk_officer';

/** Valida il modello richiesto contro la whitelist; fallback al default se non valido/assente. */
function resolveModel(requestedModel) {
    return AGENT_MODELS.some((m) => m.id === requestedModel) ? requestedModel : DEFAULT_MODEL;
}

/**
 * Valida gli id dei tool richiesti contro l'elenco di quelli realmente
 * disponibili. Se 'requestedTools' non è un array (client non l'ha inviato),
 * abilita tutti i tool di default; se è un array esplicito (anche vuoto),
 * la scelta del client viene rispettata cosi' com'è.
 */
function resolveTools(requestedTools, availableToolIds) {
    if (!Array.isArray(requestedTools)) {
        return [...availableToolIds];
    }
    return requestedTools.filter((id) => availableToolIds.includes(id));
}

/** Valida la persona richiesta contro le persona disponibili; fallback al default. */
function resolvePersona(requestedPersona) {
    return AGENT_PERSONAS[requestedPersona] ? requestedPersona : DEFAULT_PERSONA;
}

module.exports = {
    AGENT_MODELS,
    AGENT_TOOLS_META,
    AGENT_PERSONAS,
    DEFAULT_MODEL,
    DEFAULT_PERSONA,
    resolveModel,
    resolveTools,
    resolvePersona
};
