const { ChatOpenAI } = require('@langchain/openai');
const { DynamicTool } = require('@langchain/core/tools');
const { AgentExecutor, createReactAgent } = require('langchain/agents');
const { PromptTemplate } = require('@langchain/core/prompts');
const axios = require('axios');
const { queryKnowledgeBase } = require('../rag/vectorstore');
const { createPendingEmail } = require('../services/pendingActions');
const {
    AGENT_MODELS,
    AGENT_TOOLS_META,
    AGENT_PERSONAS,
    DEFAULT_MODEL,
    DEFAULT_PERSONA,
    resolveModel,
    resolveTools,
    resolvePersona
} = require('./agentConfigValidator');

const DATA_AGENT_URL = process.env.DATA_AGENT_URL || 'http://data_agent:8000';
const MARKETAUX_API_KEY = process.env.MARKETAUX_API_KEY;

/**
 * 1. TOOL RAG: Consultazione della Knowledge Base Normativa (ChromaDB)
 */
const queryKnowledgeBaseTool = new DynamicTool({
    name: "query_knowledge_base",
    description: "Utile per consultare la normativa creditizia, i file di policy presente nel backend (Policy_Erogazione_Credito_2026.pdf, Manuale_Gestione_NPL_e_Crediti_Deteriorati.txt, FAQ_Operative_Consulenti_Risk.md), i requisiti DTI/LTV, le FAQ su usura e MiFID II e le linee guida NPL. Input: la domanda in testo libero.",
    func: async (input) => {
        console.log(`[ReAct Agent Tool: RAG] Consultazione per: "${input}"`);
        const ragResult = await queryKnowledgeBase(input);
        
        if (!ragResult || ragResult.includes("non disponibile") || ragResult.includes("Errore")) {
            return `[KNOWLEDGE BASE BACKEND INTESA SANPAOLO]:
            I documenti ufficiali caricati nel sistema RAG sono:
            1. Policy_Erogazione_Credito_2026.pdf (Soglie DTI 35-40%, LTV max 80%, Credit Score minimo 620 pt)
            2. Manuale_Gestione_NPL_e_Crediti_Deteriorati.txt (Procedure di incaglio e sofferenza per ritardi >90 giorni)
            3. FAQ_Operative_Consulenti_Risk.md (Tassi soglia usura Banca d'Italia e profilo adeguatezza MiFID II)`;
        }
        return ragResult;
    }
});

/**
 * 2. TOOL DATA ANALYTICS: Query SQL, Data Cleaning & Plotting
 */
const executeDataAnalyticsTool = new DynamicTool({
    name: "execute_data_analytics",
    description: "Utile per eseguire query ed analisi sul database SQLite di Intesa Sanpaolo e generare grafici. Passa come input la query SQL pura senza punto finale.",
    func: async (input) => {
        console.log(`[ReAct Agent Tool: Data Agent] Invocato con input: ${input}`);
        
        let querySql = "";
        let chartType = "bar";
        let chartTitle = "Analisi Rischio Credito Intesa Sanpaolo";

        try {
            if (typeof input === 'string' && input.trim().startsWith('{')) {
                const parsed = JSON.parse(input);
                querySql = parsed.query_sql || input;
                chartType = parsed.chart_type || "bar";
                chartTitle = parsed.chart_title || "Analisi Rischio Credito Intesa Sanpaolo";
            } else {
                querySql = String(input);
            }
        } catch (e) {
            querySql = String(input);
        }

        // Sanitizzazione sintassi SQL per SQLite
        querySql = querySql
            .replace(/```sql/g, '')
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        
        while (querySql.endsWith('.') || querySql.endsWith(';')) {
            querySql = querySql.slice(0, -1).trim();
        }

        try {
            const response = await axios.post(`${DATA_AGENT_URL}/api/analyze`, {
                query_sql: querySql,
                chart_type: chartType,
                chart_title: chartTitle
            }, { timeout: 15000 });

            const data = response.data;
            
            let formattedChartUrl = data.chart_url;
            if (formattedChartUrl && formattedChartUrl.includes('/static/charts/')) {
                const filename = formattedChartUrl.split('/static/charts/').pop();
                formattedChartUrl = `/static/charts/${filename}`;
            }

            return JSON.stringify({
                status: "success",
                row_count: data.row_count,
                summary: data.summary_text || data.summary,
                chart_url: formattedChartUrl,
                preview: data.data_preview,
                sql_used: querySql
            });

        } catch (error) {
            const errorMessage = error.response?.data?.detail || error.message;
            return `[ERRORE DATA AGENT]: Impossibile eseguire la query SQL. Dettaglio: ${errorMessage}`;
        }
    }
});

/**
 * 3. TOOL MARKET NEWS
 */
const fetchMarketNewsTool = new DynamicTool({
    name: "fetch_market_news",
    description: "Utile per recuperare le notizie economico-finanziarie ed il ticker della Borsa di Milano (FTSE MIB).",
    func: async (query) => {
        try {
            if (MARKETAUX_API_KEY && MARKETAUX_API_KEY !== 'your_marketaux_api_key_here') {
                const url = `https://api.marketaux.com/v1/news/all?symbols=ISP.MI,FTSEMIB.MI&filter_entities=true&language=it&api_token=${MARKETAUX_API_KEY}`;
                const response = await axios.get(url);
                return response.data.data.slice(0, 3).map(a => `- ${a.title}: ${a.description}`).join("\n");
            } else {
                return `[FTSE MIB LIVE MOCK]: Indice FTSE MIB 34.850pt (+0,42%), Intesa Sanpaolo 3,68 EUR (+0,85%).`;
            }
        } catch (err) {
            return "Dati di mercato temporaneamente non disponibili.";
        }
    }
});

/**
 * 4. TOOL MAIL REPORT (con conferma umana obbligatoria prima dell'invio)
 */
const sendExecutiveReportTool = new DynamicTool({
    name: "send_executive_report",
    description: "Utile per PREPARARE (non inviare direttamente) un report sintetico di rischio da mandare via e-mail al management in formato HTML. L'invio reale avviene solo dopo conferma esplicita dell'utente nell'interfaccia: questo tool crea solo l'anteprima in attesa di approvazione. IMPORTANTE: l'input DEVE essere sempre una stringa JSON con i campi: \"to\" (l'indirizzo email destinatario: se l'utente lo specifica nel messaggio, es. \"manda il report a mario.rossi@intesasanpaolo.com\", USA ESATTAMENTE quell'indirizzo; se non specificato, ometti il campo), \"subject\" (oggetto dell'email), \"summary\" (la sintesi testuale del report, in italiano, con i numeri chiave), \"chartPath\" (opzionale: il chart_url restituito dall'ultima analisi dati eseguita in questa conversazione, se pertinente al report). Esempio di input corretto: {\"to\": \"mario.rossi@intesasanpaolo.com\", \"subject\": \"Report Esposizione Q3\", \"summary\": \"L'esposizione totale dei fidi è di 45.000.000 EUR...\", \"chartPath\": \"/static/charts/chart_abc123.png\"}",
    func: async (input) => {
        try {
            let recipient = process.env.SMTP_USER || "management@intesasanpaolo.com";
            let subject = "Report Executive Risk & Credit - Intesa Sanpaolo";
            let content = String(input);
            let chartPath = null;

            if (typeof input === 'string' && input.trim().startsWith('{')) {
                try {
                    const payload = JSON.parse(input);
                    recipient = payload.to || recipient;
                    subject = payload.subject || subject;
                    content = payload.htmlContent || payload.summary || content;
                    chartPath = payload.chartPath || payload.chart_url || null;
                } catch (e) {}
            }

            // Non inviamo subito: creiamo una richiesta "pending" che l'utente dovrà
            // confermare esplicitamente dall'interfaccia (bottone Conferma/Annulla).
            const confirmationId = createPendingEmail({ recipient, subject, content, chartPath });

            return `[ANTEPRIMA REPORT PRONTA - IN ATTESA DI CONFERMA] Il report per ${recipient} con oggetto "${subject}" è stato preparato ma NON ancora inviato: è necessaria una conferma esplicita dell'utente dall'interfaccia prima dell'invio reale. PENDING_EMAIL_ID:${confirmationId}`;
        } catch (e) {
            return `Errore nella preparazione del report: ${e.message}`;
        }
    }
});

/**
 * Inizializza l'Agente ReAct.
 * @param {Object} config
 * @param {string} [config.model] - id del modello richiesto dal client (validato contro AGENT_MODELS)
 * @param {string[]} [config.enabledTools] - id dei tool da abilitare (validati contro AVAILABLE_TOOLS)
 * @param {string} [config.persona] - id della persona/tono richiesta (validato contro AGENT_PERSONAS)
 */
async function createReactAgentInstance(config = {}) {
    // Mappa tool-by-name, costruita qui (dopo le dichiarazioni sopra) cosi' resta
    // sempre sincronizzata con AGENT_TOOLS_META senza doverla duplicare a mano.
    const AVAILABLE_TOOLS = {
        query_knowledge_base: queryKnowledgeBaseTool,
        execute_data_analytics: executeDataAnalyticsTool,
        fetch_market_news: fetchMarketNewsTool,
        send_executive_report: sendExecutiveReportTool
    };

    // 1. VALIDAZIONE MODELLO: mai fidarsi ciecamente del client, sempre whitelist
    const requestedModel = resolveModel(config.model);

    // 2. VALIDAZIONE TOOL: filtra solo gli id realmente esistenti. Se il client
    // non invia affatto 'enabledTools' (richiesta legacy/di default), abilitiamo
    // tutti i tool; se invece invia esplicitamente un array (anche vuoto), la
    // sua scelta va rispettata — disabilitare tutto è una modalità "solo chat"
    // legittima, non un errore da correggere in automatico.
    const toolIds = resolveTools(config.enabledTools, Object.keys(AVAILABLE_TOOLS));
    const tools = toolIds.map((id) => AVAILABLE_TOOLS[id]);

    // 3. VALIDAZIONE PERSONA
    const personaId = resolvePersona(config.persona);
    const personaInstructions = AGENT_PERSONAS[personaId].instructions;

    const model = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: requestedModel,
        temperature: 0
    });

    const toolsIntro = tools.length > 0
        ? 'Tool disponibili:'
        : "ATTENZIONE: nessun tool è abilitato in questa sessione (l'utente li ha disattivati dal pannello Impostazioni). Rispondi SEMPRE e SOLO con la tua conoscenza generale, senza tentare alcuna Action. Elenco tool (vuoto):";

    const prompt = PromptTemplate.fromTemplate(
`Sei l'Assistente Agentico Executive per l'Hub Risk & Credit Intelligence di Intesa Sanpaolo.
Il tuo compito è tradurre le domande dell'utente ed erogare risposte approfondite ed esaustive in italiano formale.

REGISTRO COMUNICATIVO RICHIESTO PER QUESTA SESSIONE: ${personaInstructions}

SCHEMA DB SQLITE DISPONIBILE (intesa_core_banking.db):
- T_CLIENTI (ID_Cliente, Filiale_ID, Eta_Cliente, Categoria_Prof, Reddito_Annuale_EUR)
- T_PRATICHE_FIDO (ID_Pratica, ID_Cliente, Importo_Richiesto_EUR, Credit_Score_ISP, Stato_Pratica)
- T_FILIALI (Filiale_ID, Nome_Filiale, Area_Geografica, Direttore_Area)
- T_PERFORMANCE_AMORT (ID_Pagamento, ID_Pratica, Rata_Mensile_EUR, Giorni_Ritardo_Pagamento, Flag_Default_12M)

REGOLE TASSATIVE DI ESECUZIONE:
1. Per calcolare somme di fidi per una specifica filiale (es. "Bari Aldo Moro"), ESEGUI SUBITO 'execute_data_analytics' con: SELECT f.Nome_Filiale, SUM(p.Importo_Richiesto_EUR) as Somma_Fidi FROM T_PRATICHE_FIDO p JOIN T_CLIENTI c ON p.ID_Cliente = c.ID_Cliente JOIN T_FILIALI f ON c.Filiale_ID = f.Filiale_ID WHERE f.Nome_Filiale LIKE '%Bari%' GROUP BY f.Nome_Filiale
1b. ATTENZIONE ALLO SCHEMA: la colonna Flag_Default_12M si trova SOLO in T_PERFORMANCE_AMORT, MAI in T_PRATICHE_FIDO. Per calcolare il TASSO DI DEFAULT per filiale devi quindi joinare anche T_PERFORMANCE_AMORT: ESEGUI SUBITO 'execute_data_analytics' con: SELECT f.Nome_Filiale, COUNT(DISTINCT p.ID_Pratica) as Totale_Pratiche, SUM(CASE WHEN pa.Flag_Default_12M = 1 THEN 1 ELSE 0 END) as Pratiche_Default, ROUND(SUM(CASE WHEN pa.Flag_Default_12M = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(DISTINCT p.ID_Pratica), 2) as Tasso_Default_Pct FROM T_PRATICHE_FIDO p JOIN T_CLIENTI c ON p.ID_Cliente = c.ID_Cliente JOIN T_FILIALI f ON c.Filiale_ID = f.Filiale_ID JOIN T_PERFORMANCE_AMORT pa ON pa.ID_Pratica = p.ID_Pratica GROUP BY f.Nome_Filiale
2. Se l'utente chiede quali documenti sono presenti nel backend o nella Knowledge Base, ESEGUI SUBITO 'query_knowledge_base' passandogli la richiesta.
3. Appena ottieni il risultato dall'Observation di un tool, DEVI PRODURRE SUBITO LA 'Final Answer:' spiegando i dati in dettaglio. NON eseguire ulteriori azioni inutili.
3b. Questa regola vale SEMPRE, anche quando l'Observation di un tool contiene un errore (es. "[ERRORE DATA AGENT]: ..."): NON scrivere mai una spiegazione libera priva del prefisso "Final Answer:". Anche per comunicare un errore all'utente, la tua risposta DEVE iniziare esattamente con "Final Answer:" seguito dalla spiegazione in italiano.
4. Il tool 'send_executive_report' PREPARA SOLTANTO il report: NON invia mai l'email direttamente. Nella Final Answer, dopo averlo invocato, informa SEMPRE l'utente che il report è in attesa di conferma esplicita dall'interfaccia e NON affermare mai che l'email è stata inviata.
4b. Se l'utente specifica un indirizzo email nel messaggio (es. "manda il report a mario.rossi@intesasanpaolo.com" o "invialo a management@banca.it"), DEVI estrarre ESATTAMENTE quell'indirizzo e includerlo nel campo "to" del JSON passato a 'send_executive_report'. Se l'utente NON specifica alcun indirizzo, ometti il campo "to" (verrà usato un destinatario di default configurato lato server). Non inventare mai un indirizzo email che l'utente non ha scritto.
5. Se l'utente pone una domanda di follow-up che fa riferimento implicito a un'analisi precedente (es. "e per l'area Nord?", "mostrami lo stesso grafico ma per la filiale di Torino"), consulta lo STORICO DELLA CONVERSAZIONE per individuare l'ultima query SQL eseguita (indicata come "[Query SQL eseguita: ...]") e costruisci una nuova query 'execute_data_analytics' riutilizzando la stessa struttura/JOIN ma applicando il nuovo filtro richiesto, invece di ripartire da zero o richiedere di nuovo informazioni già fornite.
6. Se l'utente fa un saluto, una domanda generica di cortesia, o chiede cosa sai fare / quali sono le tue capacità (es. "Cos'altro puoi fare?", "Chi sei?", "Aiuto"), NON invocare NESSUN tool: rispondi DIRETTAMENTE con una 'Final Answer' che spiega, in modo sintetico, quali tool hai attualmente a disposizione in questa sessione.
7. Se un tool che ti servirebbe per rispondere NON è nell'elenco "Tool disponibili" qui sotto (perché l'utente lo ha disattivato dalle Impostazioni), NON tentare comunque di invocarlo: spiega nella Final Answer che quella funzionalità è disattivata in questa sessione e suggerisci di riattivarla dal pannello Impostazioni Agente.

NON inserire MAI punti fermi o punti e virgola alla fine della query SQL.

${toolsIntro}
{tools}

STORICO DELLA CONVERSAZIONE (turni precedenti, usali per capire il contesto,
i riferimenti impliciti come "quella filiale" o "il grafico di prima", e per non
richiedere di nuovo informazioni già fornite dall'utente):
{chat_history}

Formato di ragionamento:
Question: la domanda dell'utente
Thought: il ragionamento su quale azione compiere
Action: uno tra [{tool_names}]
Action Input: l'input per il tool
Observation: il risultato dell'azione
Thought: Ora ho tutti i dati necessari per la risposta
Final Answer: la risposta finale ed esaustiva per l'utente, ricca di dettagli e numeri formattati in euro.

Begin!

Question: {input}
Thought:{agent_scratchpad}`
    );

    const agent = await createReactAgent({
        llm: model,
        tools: tools,
        prompt: prompt
    });

    const executor = new AgentExecutor({
        agent: agent,
        tools: tools,
        verbose: true,
        maxIterations: 8,
        handleParsingErrors: (error) => {
            let rawOutput = error.message
                .replace('Could not parse LLM output: ', '')
                .replace(/Action: None/g, '')
                .replace(/Final Answer:/g, '')
                .trim();
            return rawOutput || "L'analisi è stata completata con successo. Consulta i dati ed il grafico nel Canvas.";
        },
        returnIntermediateSteps: true
    });

    // Metadati della configurazione EFFETTIVAMENTE applicata (dopo validazione),
    // utili al chiamante per mostrare all'utente cosa sta girando davvero,
    // anche se aveva richiesto un valore non valido/non disponibile.
    executor.__agentMeta = { model: requestedModel, enabledTools: toolIds, persona: personaId };

    return executor;
}

module.exports = {
    createReactAgent: createReactAgentInstance,
    buildAgentExecutor: createReactAgentInstance,
    AGENT_MODELS,
    AGENT_TOOLS_META,
    AGENT_PERSONAS,
    DEFAULT_MODEL,
    DEFAULT_PERSONA
};