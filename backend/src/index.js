require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { BaseCallbackHandler } = require('@langchain/core/callbacks/base');

// Importazione diretta ed esplicita della funzione dell'Agente ReAct e del RAG
const {
    createReactAgent,
    AGENT_MODELS,
    AGENT_TOOLS_META,
    AGENT_PERSONAS,
    DEFAULT_MODEL,
    DEFAULT_PERSONA
} = require('./agent/reactAgent');
const { getVectorStore, resetVectorStore } = require('./rag/vectorstore');
const { sendExecutiveEmail } = require('./services/mailService');
const { getPendingEmail, resolvePendingEmail } = require('./services/pendingActions');

const app = express();
const PORT = process.env.PORT || 5000;
const MARKETAUX_API_KEY = process.env.MARKETAUX_API_KEY;
// Render (fromService/hostport) restituisce solo "host:porta" senza schema;
// Docker Compose invece usa il valore di default gia' completo di "http://".
function withScheme(url) {
    return /^https?:\/\//i.test(url) ? url : `http://${url}`;
}
const DATA_AGENT_URL = withScheme(process.env.DATA_AGENT_URL || 'http://data_agent:8000');
const DOCS_DIR = path.resolve(__dirname, '../docs');
const ALLOWED_DOC_EXTENSIONS = ['.pdf', '.txt', '.md'];

// Middleware di base
app.use(cors());
app.use(express.json());

// Rete di sicurezza: se per qualsiasi motivo un errore sfugge ai try/catch delle
// singole route (es. un package di terze parti che lancia in modo asincrono fuori
// da una Promise gestita), lo logghiamo in modo esplicito invece di lasciar
// crashare il processo Node in silenzio, cosa che spiegherebbe un fallimento
// di TUTTE le richieste successive fino al riavvio manuale del container.
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err && err.stack ? err.stack : err);
});

// Inizializzazione della Knowledge Base e del Server Express
async function initializeServer() {
    console.log("=================================================");
    console.log("  NOVABANCA - RISK HUB BACKEND ORCHESTRATOR");
    console.log("=================================================");

    try {
        console.log("[Startup] Verifico connessione ed indicizzazione su ChromaDB...");
        await getVectorStore();
    } catch (error) {
        console.warn("[Startup Warning] Inizializzazione RAG in background:", error.message);
    }

    console.log("[Startup] ReAct Agent pronto e operativo!");
}

// -----------------------------------------------------------------------------
// UTILITY: Memoria conversazionale
// -----------------------------------------------------------------------------
// Converte l'array di messaggi [{role, content, sql}] inviato dal frontend in un testo
// leggibile da iniettare nel prompt dell'agente ReAct. Se un turno bot include la
// query SQL usata, la riportiamo esplicitamente: serve all'agente per i follow-up
// di drill-down (es. "e per l'area Nord?") senza dover ripartire da zero.
function formatChatHistory(chatHistory) {
    if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
        return "(Nessuno storico precedente: è il primo messaggio della sessione)";
    }
    return chatHistory
        .map((turn) => {
            const speaker = turn.role === 'human' || turn.role === 'user' ? 'Utente' : 'Assistente';
            let line = `${speaker}: ${turn.content}`;
            if (turn.sql) {
                line += `\n[Query SQL eseguita: ${turn.sql}]`;
            }
            return line;
        })
        .join('\n');
}

// -----------------------------------------------------------------------------
// UTILITY: Estrazione dati strutturati dagli intermediateSteps dell'agente
// -----------------------------------------------------------------------------
// Analizza gli step intermedi del ReAct Agent per estrarre: URL del grafico generato,
// query SQL usata (per il drill-down conversazionale), fonti documentali citate dalla
// RAG (per il badge di trasparenza in chat) e un'eventuale richiesta di invio email
// in attesa di conferma umana (guardrail).
function extractStructuredData(intermediateSteps) {
    let chartUrl = null;
    let lastSql = null;
    let pendingEmailId = null;
    const sources = new Set();

    if (Array.isArray(intermediateSteps)) {
        for (const step of intermediateSteps) {
            if (!step.observation) continue;
            const rawObservation = String(step.observation);

            // Fonti RAG: il tool query_knowledge_base restituisce chunk con "(Fonte: NomeFile)"
            const sourceMatches = rawObservation.matchAll(/Fonte:\s*([^)]+)\)/g);
            for (const m of sourceMatches) {
                sources.add(m[1].trim());
            }

            // Report email in attesa di conferma
            const pendingMatch = rawObservation.match(/PENDING_EMAIL_ID:([a-zA-Z0-9-]+)/);
            if (pendingMatch) {
                pendingEmailId = pendingMatch[1];
            }

            // Dati strutturati dal Data Agent (chart_url, sql_used)
            try {
                const obs = typeof step.observation === 'string' ? JSON.parse(step.observation) : step.observation;
                if (obs.chart_url) chartUrl = obs.chart_url;
                if (obs.sql_used) lastSql = obs.sql_used;
            } catch (e) {
                const match = rawObservation.match(/\/static\/charts\/[a-zA-Z0-9_]+\.png/);
                if (match) chartUrl = match[0];
            }
        }
    }

    return {
        chartUrl,
        lastSql,
        sources: Array.from(sources),
        pendingEmailId
    };
}

// Ripulisce la Final Answer dal marker tecnico PENDING_EMAIL_ID, che serve solo
// al backend per l'estrazione strutturata e non deve essere mostrato all'utente.
function stripInternalMarkers(text) {
    return String(text || "")
        .replace(/PENDING_EMAIL_ID:[a-zA-Z0-9-]+/g, '')
        .trim();
}

// Costruisce, a partire da un'entry pendingEmail, l'oggetto da restituire al frontend
// (senza esporre l'intero contenuto HTML dell'email, solo un'anteprima leggibile)
function buildPendingEmailPayload(id, entry) {
    return {
        id,
        to: entry.recipient,
        subject: entry.subject,
        preview: String(entry.content).replace(/<[^>]+>/g, '').slice(0, 240)
    };
}

// -----------------------------------------------------------------------------
// ENDPOINT 1: POST /api/chat (Interrogazione Agentica - risposta unica)
// -----------------------------------------------------------------------------
// Riconosce l'errore tipico del parser ReAct quando l'LLM scrive una risposta
// discorsiva coerente ma dimentica il prefisso "Final Answer:" richiesto dal
// formato. In questo caso il testo dopo "Could not parse LLM output: " è quasi
// sempre una risposta perfettamente valida per l'utente: la recuperiamo e la
// mostriamo normalmente invece di far comparire un errore rosso spaventoso per
// quello che, di fatto, è un problema di formattazione interno e non un guasto.
function recoverFromParsingError(error) {
    const message = error && error.message ? error.message : '';
    const marker = 'Could not parse LLM output: ';
    const idx = message.indexOf(marker);
    if (idx === -1) return null;

    let recovered = message.slice(idx + marker.length).trim();
    // Rimuove eventuali residui del formato ReAct che l'LLM potrebbe aver comunque incluso
    recovered = recovered
        .replace(/^Thought:\s*/i, '')
        .replace(/\n?Action:.*$/is, '')
        .replace(/\n?Final Answer:\s*/i, '')
        .trim();

    return recovered || null;
}

app.post('/api/chat', async (req, res) => {
    try {
        const { message, chat_history, agentConfig } = req.body;
        console.log(`\n[API Chat] Messaggio ricevuto dal Frontend: "${message}"`);

        const formattedHistory = formatChatHistory(chat_history);

        const executor = await createReactAgent(agentConfig || {});
        const result = await executor.invoke({
            input: message,
            chat_history: formattedHistory
        });

        const { chartUrl, lastSql, sources, pendingEmailId } = extractStructuredData(result.intermediateSteps);

        let pendingEmail = null;
        if (pendingEmailId) {
            const entry = getPendingEmail(pendingEmailId);
            if (entry) pendingEmail = buildPendingEmailPayload(pendingEmailId, entry);
        }

        const replyOutput = stripInternalMarkers(result.output) || "Elaborazione completata.";
        console.log(`[API Chat] Risposta inviata al Frontend con successo!`);

        return res.status(200).json({
            reply: replyOutput,
            chartUrl,
            sql: lastSql,
            sources,
            pendingEmail,
            agentMeta: executor.__agentMeta
        });

    } catch (error) {
        const recoveredReply = recoverFromParsingError(error);
        if (recoveredReply) {
            console.warn('[API Chat] Recuperata una risposta valida da un errore di parsing ReAct (Final Answer: mancante nell\'output dell\'LLM).');
            return res.status(200).json({
                reply: recoveredReply,
                chartUrl: null,
                sql: null,
                sources: [],
                pendingEmail: null
            });
        }

        console.error('[API Chat Error] Errore durante il ciclo agentico:', error.stack || error.message);
        return res.status(500).json({
            error: "Si è verificato un errore interno durante l'elaborazione della richiesta agentica.",
            detail: error.message || String(error)
        });
    }
});

// -----------------------------------------------------------------------------
// ENDPOINT 1b: POST /api/chat/stream (Streaming del ragionamento ReAct)
// -----------------------------------------------------------------------------
// Protocollo di streaming custom in NDJSON (una riga = un evento JSON): non usiamo
// EventSource nativo perché richiede GET, mentre qui serve inviare un body (messaggio
// + storico). Il frontend legge la risposta con fetch + ReadableStream.
// Eventi emessi: {type:'thought', ...} ad ogni Thought/Action dell'agente,
// {type:'observation', ...} al termine di ogni tool, {type:'final', ...} a fine ciclo.
class ReasoningStreamHandler extends BaseCallbackHandler {
    constructor(writeEvent) {
        super();
        this.name = 'reasoning_stream_handler';
        this.writeEvent = writeEvent;
        this.currentTool = null;
    }

    // NOTA IMPORTANTE: ogni metodo è avvolto in try/catch. Il codice di
    // "instrumentazione" (che serve solo a mostrare il ragionamento live in UI)
    // non deve MAI poter interrompere l'esecuzione reale dell'agente: se un giorno
    // il formato di una Action cambia e action.log è in un formato inatteso, l'utente
    // deve comunque ricevere la risposta finale, non un errore di comunicazione.
    async handleAgentAction(action) {
        try {
            this.currentTool = action.tool;
            const thought = action.log
                ? action.log.split(/Action:/i)[0].replace(/Thought:/i, '').trim()
                : '';
            this.writeEvent({
                type: 'thought',
                thought: thought || null,
                tool: action.tool,
                toolInput: action.toolInput
            });
        } catch (e) {
            console.warn('[ReasoningStreamHandler] handleAgentAction ignorato per errore interno:', e.message);
        }
    }

    async handleToolEnd(output) {
        try {
            const text = typeof output === 'string' ? output : JSON.stringify(output);
            this.writeEvent({
                type: 'observation',
                tool: this.currentTool,
                output: text.slice(0, 600)
            });
        } catch (e) {
            console.warn('[ReasoningStreamHandler] handleToolEnd ignorato per errore interno:', e.message);
        }
    }

    async handleToolError(err) {
        try {
            this.writeEvent({
                type: 'tool_error',
                tool: this.currentTool,
                error: err && err.message ? err.message : String(err)
            });
        } catch (e) {
            console.warn('[ReasoningStreamHandler] handleToolError ignorato per errore interno:', e.message);
        }
    }
}

app.post('/api/chat/stream', async (req, res) => {
    const { message, chat_history, agentConfig } = req.body;
    console.log(`\n[API Chat Stream] Messaggio ricevuto dal Frontend: "${message}"`);

    res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        // Disabilita il buffering di Nginx per garantire lo streaming in tempo reale
        'X-Accel-Buffering': 'no'
    });

    const writeEvent = (event) => {
        try {
            res.write(JSON.stringify(event) + '\n');
        } catch (e) {
            console.error('[API Chat Stream] Impossibile scrivere sullo stream:', e.message);
        }
    };

    try {
        const formattedHistory = formatChatHistory(chat_history);
        const executor = await createReactAgent(agentConfig || {});
        const streamingHandler = new ReasoningStreamHandler(writeEvent);

        const result = await executor.invoke(
            { input: message, chat_history: formattedHistory },
            { callbacks: [streamingHandler] }
        );

        const { chartUrl, lastSql, sources, pendingEmailId } = extractStructuredData(result.intermediateSteps);

        let pendingEmail = null;
        if (pendingEmailId) {
            const entry = getPendingEmail(pendingEmailId);
            if (entry) pendingEmail = buildPendingEmailPayload(pendingEmailId, entry);
        }

        writeEvent({
            type: 'final',
            reply: stripInternalMarkers(result.output) || "Elaborazione completata.",
            chartUrl,
            sql: lastSql,
            sources,
            pendingEmail,
            agentMeta: executor.__agentMeta
        });

    } catch (error) {
        const recoveredReply = recoverFromParsingError(error);
        if (recoveredReply) {
            console.warn('[API Chat Stream] Recuperata una risposta valida da un errore di parsing ReAct (Final Answer: mancante nell\'output dell\'LLM).');
            writeEvent({
                type: 'final',
                reply: recoveredReply,
                chartUrl: null,
                sql: null,
                sources: [],
                pendingEmail: null
            });
        } else {
            // Logghiamo lo stack completo in console (fondamentale per capire la causa reale
            // durante lo sviluppo) e includiamo anche il messaggio nell'evento SSE: essendo
            // un progetto didattico/dimostrativo è preferibile poter diagnosticare subito
            // l'errore (es. "Incorrect API key provided", "ECONNREFUSED 127.0.0.1:8000",
            // "Agent stopped due to max iterations") piuttosto che nasconderlo dietro un
            // messaggio generico. In un contesto di produzione reale andrebbe ridotto il
            // dettaglio esposto al client.
            console.error('[API Chat Stream Error]', error.stack || error.message);
            writeEvent({
                type: 'error',
                error: "Si è verificato un errore interno durante l'elaborazione della richiesta agentica.",
                detail: error.message || String(error)
            });
        }
    } finally {
        res.end();
    }
});

// -----------------------------------------------------------------------------
// ENDPOINT 1c: POST /api/confirm-email (Guardrail: conferma umana prima dell'invio)
// -----------------------------------------------------------------------------
app.post('/api/confirm-email', async (req, res) => {
    const { id, approved } = req.body;

    if (!id) {
        return res.status(400).json({ success: false, message: "ID di conferma mancante." });
    }

    const entry = resolvePendingEmail(id);

    if (!entry) {
        return res.status(404).json({
            success: false,
            message: "Richiesta di invio scaduta o non trovata. Rigenera il report dalla chat."
        });
    }

    if (!approved) {
        console.log(`[Confirm Email] Invio annullato dall'utente per ${entry.recipient}`);
        return res.status(200).json({ success: true, sent: false, message: "Invio annullato." });
    }

    try {
        const result = await sendExecutiveEmail(entry.recipient, entry.subject, entry.content, entry.chartPath);
        if (result.success) {
            console.log(`[Confirm Email] Email inviata con successo a ${entry.recipient}`);
            return res.status(200).json({ success: true, sent: true, message: `Email inviata a ${entry.recipient}.` });
        } else {
            return res.status(200).json({ success: false, sent: false, message: `Invio fallito: ${result.error}` });
        }
    } catch (error) {
        console.error('[Confirm Email Error]', error.message);
        return res.status(500).json({ success: false, sent: false, message: "Errore interno durante l'invio dell'email." });
    }
});

// -----------------------------------------------------------------------------
// ENDPOINT 2: GET /api/market-news (Ticker Borsa FTSE MIB / News)
// -----------------------------------------------------------------------------
// Ticker di default mostrato sempre in TopBar (aggiornabile in futuro con una vera API di mercato)
const DEFAULT_TICKER = [
    { symbol: 'FTSE MIB', price: '34.850,20', change: '+0.42%' },
    { symbol: 'NVB.MI', price: '3.68 EUR', change: '+0.85%' },
    { symbol: 'EUR/USD', price: '1.0885', change: '-0.12%' },
    { symbol: 'BTP 10Y Yield', price: '3.54%', change: '-0.03%' }
];

app.get('/api/market-news', async (req, res) => {
    // NOTA: la risposta DEVE avere la forma { ticker: [...], news: [...] } perché
    // è quella attesa da TopBar.jsx sul frontend.
    try {
        if (MARKETAUX_API_KEY && MARKETAUX_API_KEY !== 'your_marketaux_api_key_here') {
            const url = `https://api.marketaux.com/v1/news/all?symbols=NVB.MI,FTSEMIB.MI&filter_entities=true&language=it&api_token=${MARKETAUX_API_KEY}`;
            const response = await axios.get(url);
            const news = (response.data.data || []).map(a => ({ title: a.title, source: a.source }));
            return res.status(200).json({ ticker: DEFAULT_TICKER, news });
        } else {
            return res.status(200).json({
                ticker: DEFAULT_TICKER,
                news: [
                    { title: "Borsa Milano tonica: FTSE MIB a 34.850pt (+0,42%)", source: "Ansa Borsa" },
                    { title: "NovaBanca (NVB.MI) tocca 3,68 EUR (+0,85%)", source: "Il Sole 24 Ore" },
                    { title: "Banca d'Italia conferma la tenuta del CET1 ratio bancario", source: "Milano Finanza" }
                ]
            });
        }
    } catch (error) {
        console.warn('[API Market News Fallback] Utilizzo dati di Borsa Mock locali.');
        return res.status(200).json({
            ticker: DEFAULT_TICKER,
            news: [
                { title: "Indice FTSE MIB stazionario a 34.850pt (+0,42%)", source: "Market Live" },
                { title: "NovaBanca (NVB.MI): Solida posizione di capitale e tassi in linea", source: "NVB Research" }
            ]
        });
    }
});

// -----------------------------------------------------------------------------
// ENDPOINT 3: GET /api/kpis (Dashboard KPI - proxy verso il Data Agent Python)
// -----------------------------------------------------------------------------
app.get('/api/kpis', async (req, res) => {
    try {
        const response = await axios.get(`${DATA_AGENT_URL}/api/kpis`, { timeout: 10000 });
        return res.status(200).json(response.data);
    } catch (error) {
        console.warn('[API KPIs] Data Agent non raggiungibile, restituisco fallback vuoto:', error.message);
        return res.status(200).json({
            kpis: [],
            error: "Dashboard KPI temporaneamente non disponibile."
        });
    }
});

// -----------------------------------------------------------------------------
// ENDPOINT 4: GET /api/agent-config/options (Opzioni disponibili per il pannello Impostazioni)
// -----------------------------------------------------------------------------
// Il frontend NON deve hardcodare modelli/tool/persona: li richiede sempre qui,
// cosi' i due lati restano sempre sincronizzati con le whitelist reali del backend.
// -----------------------------------------------------------------------------
// PROXY GRAFICI: GET /static/charts/:filename
// -----------------------------------------------------------------------------
// In locale (Docker Compose) le immagini dei grafici sono servite direttamente
// da Nginx, che proxa /static verso il Data Agent. In un deploy disaccoppiato
// (es. Render, dove frontend è un sito statico senza Nginx davanti) questo
// proxy applicativo fa la stessa cosa: il frontend chiede sempre le immagini
// all'origin del backend (vedi resolveAssetUrl in frontend/src/config.js),
// e qui le inoltriamo al Data Agent, che è l'unico a conoscerne il percorso.
app.get('/static/charts/:filename', async (req, res) => {
    try {
        const safeFilename = path.basename(req.params.filename); // anti path-traversal
        const response = await axios.get(`${DATA_AGENT_URL}/static/charts/${safeFilename}`, {
            responseType: 'stream',
            timeout: 10000
        });
        res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
        response.data.pipe(res);
    } catch (error) {
        console.error('[Static Proxy] Impossibile recuperare il grafico dal Data Agent:', error.message);
        res.status(404).send('Grafico non trovato o Data Agent non raggiungibile.');
    }
});

app.get('/api/agent-config/options', (req, res) => {
    return res.status(200).json({
        models: AGENT_MODELS,
        defaultModel: DEFAULT_MODEL,
        tools: AGENT_TOOLS_META,
        personas: Object.entries(AGENT_PERSONAS).map(([id, p]) => ({ id, label: p.label })),
        defaultPersona: DEFAULT_PERSONA
    });
});

// -----------------------------------------------------------------------------
// ENDPOINT 5: Gestione Documenti Knowledge Base (RAG)
// -----------------------------------------------------------------------------
const upload = multer({
    dest: path.join(__dirname, '../.uploads_tmp'),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, ALLOWED_DOC_EXTENSIONS.includes(ext));
    }
});

// GET: elenco documenti attualmente indicizzati nella Knowledge Base
app.get('/api/knowledge-base/documents', (req, res) => {
    try {
        if (!fs.existsSync(DOCS_DIR)) return res.status(200).json({ documents: [] });
        const documents = fs.readdirSync(DOCS_DIR)
            .filter((f) => ALLOWED_DOC_EXTENSIONS.includes(path.extname(f).toLowerCase()))
            .map((f) => {
                const stats = fs.statSync(path.join(DOCS_DIR, f));
                return { name: f, sizeKb: Math.round(stats.size / 1024) };
            });
        return res.status(200).json({ documents });
    } catch (error) {
        console.error('[Knowledge Base] Errore lettura documenti:', error.message);
        return res.status(500).json({ error: "Impossibile leggere i documenti della Knowledge Base." });
    }
});

// POST: upload di un nuovo documento (.pdf, .txt, .md) e re-indicizzazione automatica
app.post('/api/knowledge-base/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            error: "File non valido. Sono ammessi solo .pdf, .txt, .md fino a 5MB."
        });
    }

    try {
        // Sanitizzazione del nome file: solo il basename, niente caratteri di path
        // traversal (../) o caratteri speciali, per evitare scritture fuori da DOCS_DIR
        const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9_.\-]/g, '_');
        if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

        const destPath = path.join(DOCS_DIR, safeName);
        fs.renameSync(req.file.path, destPath);

        // Invalida la cache del vector store: la prossima query RAG re-indicizzerà
        // TUTTI i documenti in DOCS_DIR, incluso quello appena caricato.
        resetVectorStore();

        console.log(`[Knowledge Base] Nuovo documento caricato e indicizzazione invalidata: ${safeName}`);
        return res.status(200).json({ success: true, filename: safeName });

    } catch (error) {
        console.error('[Knowledge Base] Errore upload documento:', error.message);
        // Ripulisce il file temporaneo se qualcosa è andato storto dopo l'upload
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(500).json({ error: "Errore durante il salvataggio del documento." });
    }
});

// DELETE: rimozione di un documento dalla Knowledge Base
app.delete('/api/knowledge-base/documents/:filename', (req, res) => {
    try {
        const safeName = path.basename(req.params.filename);
        const targetPath = path.join(DOCS_DIR, safeName);

        if (!targetPath.startsWith(DOCS_DIR) || !fs.existsSync(targetPath)) {
            return res.status(404).json({ error: "Documento non trovato." });
        }

        fs.unlinkSync(targetPath);
        resetVectorStore();

        console.log(`[Knowledge Base] Documento rimosso e indicizzazione invalidata: ${safeName}`);
        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('[Knowledge Base] Errore rimozione documento:', error.message);
        return res.status(500).json({ error: "Errore durante la rimozione del documento." });
    }
});

// Avvio del server Express sulla porta 5000
app.listen(PORT, () => {
    console.log(`[HTTP Server] Backend Orchestrator in ascolto sulla porta ${PORT}`);
    console.log(`[Endpoint] Chat API: http://localhost:${PORT}/api/chat`);
    console.log(`[Endpoint] Chat Stream API: http://localhost:${PORT}/api/chat/stream`);
    console.log(`[Endpoint] Confirm Email API: http://localhost:${PORT}/api/confirm-email`);
    console.log(`[Endpoint] KPI Dashboard API: http://localhost:${PORT}/api/kpis`);
    console.log(`[Endpoint] Market News API: http://localhost:${PORT}/api/market-news`);
    console.log("=================================================\n");
});

initializeServer();
