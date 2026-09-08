# Matrice di Conformità al Brief di Progetto

Questo documento mappa esplicitamente ogni requisito del brief originale al codice
che lo soddisfa, per facilitare la valutazione tecnica del progetto.

## Scenario e ambito scelto

**Azienda**: Intesa Sanpaolo (caso realistico ispirato all'azienda reale)
**Reparto/ambito**: Risk & Credit — analisi del rischio creditizio e consultazione
normativa per consulenti/analisti di credito.

Le due esigenze informative complementari richieste dal brief:
- **Testuale**: policy di erogazione credito, manuale gestione NPL, FAQ operative → `backend/docs/`
- **Numerica**: pratiche di fido, performance di rimborso, dati clienti/filiali → `data_agent/database/intesa_core_banking.db`

## Step preliminare: dati e knowledge base

| Requisito | Stato | Dove |
|---|---|---|
| CSV/dataset ≥1000 righe | ✅ | `data_agent/database/intesa_core_banking.db` — 1200 record in `T_PRATICHE_FIDO`, generati con seed riproducibile in `notebooks/01_generazione_dataset_e_knowledge_base.ipynb` |
| Dati "sporchi" (nulli, duplicati, formati incoerenti, outlier) | ✅ | Iniezione controllata (~10-12%) nel notebook di generazione: reddito nullo (4%), età nulla (4%), spazi superflui nelle categorie (3%), outlier Credit Score fuori range 300-850 (3%). Puliti in `data_agent/agent_engine.py::clean_dataset()` |
| Documento testuale/PDF per la KB | ✅ | `backend/docs/`: `Policy_Erogazione_Credito_2026.pdf`, `Manuale_Gestione_NPL_e_Crediti_Deteriorati.txt`, `FAQ_Operative_Consulenti_Risk.md` (3 documenti, oltre il minimo richiesto di 1) |

**Nota sull'architettura dati**: il brief parla di un "file CSV". Il dataset di
questo progetto è stato generato direttamente come **schema relazionale
SQLite a 4 tabelle** (`T_CLIENTI`, `T_PRATICHE_FIDO`, `T_FILIALI`,
`T_PERFORMANCE_AMORT`, vedi `notebooks/01_generazione_dataset_e_knowledge_base.ipynb`),
senza passare da un CSV intermedio. Scelta deliberata per riflettere un caso
bancario più realistico: i dati di rischio creditizio sono intrinsecamente
relazionali (cliente → pratica → filiale → storico rate), una struttura che un
singolo CSV piatto rappresenterebbe solo con ridondanza o JOIN impliciti. Tutti
i requisiti sostanziali del brief (≥1000 righe, dati sporchi al 10-12%,
data cleaning con Pandas) sono comunque pienamente soddisfatti.

## Architettura a microservizi

| Requisito | Stato | Dove |
|---|---|---|
| Cartella `frontend/` (React) | ✅ | `frontend/` — Vite + React + Tailwind |
| Cartella `backend/` (Node.js, orchestratore) | ✅ | `backend/` — Express + LangChain.js |
| Cartella `data_agent/` (Python) | ✅ | `data_agent/` — FastAPI + Pandas + Seaborn |
| Endpoint `POST /api/chat` | ✅ | `backend/src/index.js` (+ variante streaming `POST /api/chat/stream`) |
| Session state e memoria conversazionale | ✅ | Storico passato dal frontend, formattato e iniettato nel prompt (`formatChatHistory()` in `index.js`) |
| RAG con ChromaDB locale | ✅ | `backend/src/rag/vectorstore.js`, servizio `chromadb` in `docker-compose.yml` |
| Orchestrazione LLM: RAG vs Data Agent | ✅ | `backend/src/agent/reactAgent.js` — agente ReAct con function calling (LangChain.js) |
| Integrazione Node ↔ Python | ✅ | Microservizio FastAPI (`data_agent/main.py`), chiamato via HTTP da `execute_data_analytics` tool |
| Data Agent: pulizia dati | ✅ | `DataAgentEngine.clean_dataset()` — vedi anche `notebooks/02_data_agent_prototyping.ipynb` e `notebooks/01_generazione_dataset_e_knowledge_base.ipynb` per il prototipo |
| Data Agent: generazione grafici (matplotlib/seaborn) | ✅ | `DataAgentEngine.generate_chart()`, salvati in `data_agent/static/charts/` e serviti via Nginx |
| Data Agent: sintesi testuale dell'analisi | ✅ | `DataAgentEngine.generate_summary()` — statistiche reali (media/min/max/categoria più frequente), non solo conteggio righe |
| File `.env` per i secret | ✅ | `.env.example` fornito come template; `.env` reale escluso da Git |
| README.md con istruzioni complete | ✅ | Vedi `README.md` nella root |

### Nota sull'architettura del Data Agent: SQL validato vs "agente pandas" free-form

Il brief descrive un "agente pandas" che riceve la domanda in linguaggio naturale
e genera autonomamente codice Python per l'analisi. Il progetto implementa
invece un **pattern a due fasi**: l'LLM del backend Node.js (che ha già in
memoria lo schema del database) decide **quale query SQL** eseguire, e il
Data Agent Python la valida, esegue in sola lettura, pulisce e visualizza.

Questa è una scelta deliberata, non una scorciatoia:
1. Il brief stesso richiede un **"interprete deterministico di codice"** — una
   query SQL validata contro una whitelist (`validate_readonly_select()` in
   `agent_engine.py`, solo `SELECT`/`WITH`, niente comandi distruttivi, niente
   query multi-statement) è per definizione più deterministica e sicura di un
   LLM che genera ed esegue Python libero via `exec()`.
2. Un vero "agente pandas" con esecuzione di codice arbitrario avrebbe richiesto
   **rimuovere** le protezioni anti-injection costruite esplicitamente per
   questo progetto (vedi sezione Sicurezza sotto).
3. Il Data Agent mantiene comunque piena autonomia deterministica su **come**
   trattare i dati una volta ricevuta la query: cleaning, scelta dei tipi,
   gestione outlier e generazione della sintesi narrativa sono **tutte
   decisioni prese autonomamente da `agent_engine.py`**, non dettate dal
   Node.js orchestratore.

I notebook `notebooks/01_generazione_dataset_e_knowledge_base.ipynb` e
`notebooks/02_data_agent_prototyping.ipynb` documentano esattamente il
processo di prototipazione suggerito dal brief, inclusa la scoperta (durante
la prototipazione) che l'LLM tende a sbagliare il JOIN per il calcolo del
tasso di default — da cui la scelta di fissarlo come esempio esplicito nel
prompt dell'agente.

## Vincoli tecnologici

| Requisito | Stato | Dove |
|---|---|---|
| Interfaccia chat in React | ✅ | `frontend/src/components/ChatBox.jsx` |
| Memoria conversazionale | ✅ | Storico reale inviato ad ogni turno (`useChat.js`), non un array vuoto |
| Indicatore di digitazione/elaborazione | ✅ | Pannello di ragionamento live (`LiveReasoningPanel` in `ChatBox.jsx`), alimentato in streaming NDJSON dal backend |
| Rendering testo + immagini (grafici) | ✅ | `InteractiveCanvas.jsx` |
| Orchestrazione tool con LangChain.js, function calling, ReAct | ✅ | `backend/src/agent/reactAgent.js` — `createReactAgent` di LangChain.js, pattern Thought/Action/Observation |
| RAG con ChromaDB locale | ✅ | Istanza Docker dedicata, re-indicizzazione automatica su upload di nuovi documenti |
| Data analysis: gestione nulli/anomalie | ✅ | `clean_dataset()`, testato in `data_agent/tests/test_agent_engine.py` |
| Grafici salvati come immagini e restituiti al frontend | ✅ | `/static/charts/*.png`, serviti da Nginx |
| Nessuna API key hardcoded | ✅ | Tutte le chiavi via `process.env`, mai in codice sorgente |
| `.env` escluso dal version control | ✅ | `.gitignore` alla radice del progetto |

## Sicurezza (oltre il minimo richiesto)

| Misura | Dove |
|---|---|
| Validazione SQL: solo `SELECT`/`WITH`, blocco di `DROP/DELETE/UPDATE/INSERT/ALTER/ATTACH/PRAGMA` | `agent_engine.py::validate_readonly_select()` |
| Blocco query multi-statement (`; DROP TABLE ...`) | Stessa funzione |
| Connessione SQLite in sola lettura (`mode=ro`) | `agent_engine.py::get_connection()` |
| Guardrail human-in-the-loop sull'invio email: l'agente prepara solo una bozza, l'invio reale richiede conferma esplicita dell'utente | `backend/src/services/pendingActions.js` + endpoint `/api/confirm-email` |
| Porte interne (backend/data_agent/chromadb) vincolate a `127.0.0.1` in produzione | `docker-compose.yml` |
| Reverse proxy HTTPS automatico per il deploy VPS | `Caddyfile`, `docker-compose.prod.yml` |
| Sanitizzazione nomi file in upload documenti RAG (anti path-traversal) | `backend/src/index.js` — endpoint `/api/knowledge-base/upload` |

## Test automatici

| Componente | Framework | File |
|---|---|---|
| Data Agent (validatore SQL, cleaning, sintesi) | Pytest | `data_agent/tests/test_agent_engine.py` |
| Backend (validatori configurazione agente, guardrail email) | Jest | `backend/tests/*.test.js` |
| Pipeline CI | GitHub Actions | `.github/workflows/ci.yml` — esegue entrambe le suite ad ogni push/PR |

## Funzionalità aggiuntive rispetto al minimo richiesto

Non richieste esplicitamente dal brief, aggiunte per avvicinare il progetto a
uno standard "production-ready":

- Streaming in tempo reale del ragionamento ReAct (Thought/Action/Observation) in chat
- Dashboard KPI executive calcolata dal Data Agent
- Citazione delle fonti documentali usate dal RAG
- Export dei report in PDF
- Configurazione dell'agente a runtime (modello LLM, tool abilitati, persona) dal frontend
- Upload di nuovi documenti nella Knowledge Base senza toccare il codice
- Landing page con login dimostrativo e wizard di personalizzazione white-label (tema, colori, logo)
- Notebook Jupyter di prototipazione (`notebooks/`)
- Opzioni di deploy documentate: Render (Blueprint incluso) e VPS con Docker Compose + Caddy/HTTPS
