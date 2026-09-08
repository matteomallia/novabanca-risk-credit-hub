# Intesa Sanpaolo — Risk & Credit Intelligence Hub

Agente AI ibrido e multi-tool per il reparto **Risk & Credit** di una banca:
un'unica interfaccia conversazionale capace di decidere autonomamente se
consultare la normativa creditizia (RAG su ChromaDB) o delegare un'analisi
quantitativa a un Data Agent Python, generando grafici e sintesi narrative in
tempo reale.

> ⚠️ **Progetto didattico/dimostrativo.** Nessuna affiliazione con Intesa
> Sanpaolo S.p.A. Dati interamente sintetici. Vedi [`DISCLAIMER.md`](./DISCLAIMER.md).
> Per il mapping puntuale di ogni requisito del brief al codice, vedi
> [`COMPLIANCE.md`](./COMPLIANCE.md).

---

## Indice

- [Architettura](#architettura)
- [Funzionalità principali](#funzionalità-principali)
- [Struttura del repository](#struttura-del-repository)
- [Avvio rapido (Docker Compose)](#avvio-rapido-docker-compose)
- [Avvio in sviluppo (senza Docker)](#avvio-in-sviluppo-senza-docker)
- [Variabili d'ambiente](#variabili-dambiente)
- [Test automatici](#test-automatici)
- [Notebook di prototipazione](#notebook-di-prototipazione)
- [Deploy in produzione](#deploy-in-produzione)
- [Sicurezza](#sicurezza)
- [Troubleshooting](#troubleshooting)

---

## Architettura

```
┌───────────────────┐      HTTP/NDJSON        ┌────────────────────────┐
│    Frontend         │ ──────────────────────> │   Backend Orchestrator   │
│    React + Vite      │ <────────────────────── │   Node.js + LangChain      │
│    (porta 3000)      │       streaming           │   (porta 5000)             │
└───────────────────┘                          └────────────┬───────────┘
                                                                │
                                     ┌──────────────────────────┼──────────────────────────┐
                                     │                          │                            │
                                     ▼                          ▼                            ▼
                          ┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
                          │    ChromaDB           │    │    Data Agent         │    │  SMTP / Nodemailer   │
                          │    Vector Store (RAG)  │    │    Python + FastAPI    │    │  (report executive)    │
                          │    (porta 8001)        │    │    (porta 8000)        │    │                          │
                          └────────────────────┘    └───────────┬────────┘    └────────────────────┘
                                                                    │
                                                                    ▼
                                                          ┌────────────────────┐
                                                          │    SQLite              │
                                                          │    intesa_core_banking.db │
                                                          └────────────────────┘
```

**Flusso decisionale**: l'utente scrive un messaggio in chat → il Backend
Node.js costruisce un agente **ReAct** (LangChain.js) che, tramite function
calling, decide autonomamente quale tool invocare:

1. **`query_knowledge_base`** → interroga ChromaDB per rispondere con la
   normativa (policy, manuale NPL, FAQ).
2. **`execute_data_analytics`** → genera una query SQL, la invia al Data
   Agent Python che la valida, esegue in sola lettura, pulisce i dati e
   genera un grafico.
3. **`fetch_market_news`** → notizie di mercato/ticker borsistico.
4. **`send_executive_report`** → prepara (non invia) una bozza di report via
   email, in attesa di conferma umana esplicita.

Ogni passaggio del ragionamento (Thought → Action → Observation) viene
trasmesso in streaming al frontend, visibile in tempo reale in chat.

## Funzionalità principali

- **Chat con memoria conversazionale reale** e streaming del ragionamento
  dell'agente (non solo la risposta finale)
- **RAG su ChromaDB** con upload di nuovi documenti a runtime (re-indicizzazione
  automatica) dal pannello Impostazioni
- **Data Agent Python**: validazione SQL (solo `SELECT`, connessione in sola
  lettura), data cleaning automatico, generazione grafici (Seaborn), sintesi
  narrativa con statistiche reali
- **Dashboard KPI** executive sempre visibile, calcolata dal Data Agent
- **Citazione delle fonti RAG** in chat (badge cliccabili)
- **Guardrail human-in-the-loop** sull'invio email: l'agente prepara solo una
  bozza, l'invio reale richiede conferma esplicita dell'utente
- **Export dei report in PDF** (grafico + sintesi) dall'Interactive Canvas
- **Configurazione dell'agente a runtime**: modello LLM, tool abilitati,
  persona/tono delle risposte — tutto validato lato server
- **Landing page** con login dimostrativo e **wizard di personalizzazione
  white-label** (colori, logo, nome azienda, dark/light mode)
- **Sicurezza**: nessuna API key hardcoded, whitelist SQL anti-injection,
  sanitizzazione upload, porte interne non esposte pubblicamente

## Struttura del repository

```
.
├── frontend/              # React + Vite + Tailwind (interfaccia chat, dashboard, wizard)
├── backend/                # Node.js + Express + LangChain.js (orchestratore ReAct)
├── data_agent/              # Python + FastAPI + Pandas + Seaborn (analisi dati)
│   ├── database/              # intesa_core_banking.db (SQLite, dati sintetici)
│   └── tests/                  # Test Pytest
├── backend/docs/            # Documenti della Knowledge Base RAG (PDF/TXT/MD)
├── notebooks/               # Notebook Jupyter di prototipazione (vedi notebooks/README.md)
├── docker-compose.yml        # Orchestrazione dei 4 servizi (uso locale/sviluppo)
├── docker-compose.prod.yml   # Override per il deploy in produzione (Caddy + HTTPS)
├── render.yaml                # Blueprint per il deploy su Render
├── COMPLIANCE.md             # Mapping requisiti del brief -> codice
└── DISCLAIMER.md             # Nota su dati sintetici e uso previsto
```

## Avvio rapido (Docker Compose)

Prerequisiti: [Docker](https://www.docker.com/) e Docker Compose installati.

```bash
# 1. Clona il repository
git clone <URL_DEL_TUO_REPOSITORY>
cd intesa-ai-hub-monorepo

# 2. Copia il file d'ambiente e inserisci la tua chiave OpenAI
cp .env.example .env
# apri .env con un editor e imposta almeno OPENAI_API_KEY=sk-...

# 3. Avvia l'intera architettura (4 container)
docker compose up --build

# 4. Apri il browser
# Frontend:         http://localhost:3000
# Backend API:       http://localhost:5000 (uso interno, non serve aprirlo)
# Data Agent API:     http://localhost:8000/docs (Swagger UI FastAPI)
```

Il primo avvio richiede qualche minuto (build delle immagini + installazione
dipendenze + indicizzazione iniziale del RAG). I riavvii successivi sono
molto più rapidi grazie alla cache Docker.

Per fermare tutto: `docker compose down` (aggiungi `-v` per cancellare anche i
volumi persistenti di ChromaDB).

## Avvio in sviluppo (senza Docker)

Utile per iterare rapidamente su un singolo servizio. Servono 3 terminali
separati.

**Data Agent (Python)**
```bash
cd data_agent
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Backend (Node.js)** — ⚠️ il file `.env` deve trovarsi anche dentro `backend/`
(o esporta le variabili nel terminale), perché `dotenv` cerca nella cartella
da cui parte il processo:
```bash
cd backend
cp ../.env .env   # oppure crea backend/.env con le stesse variabili
npm install
npm run dev
```

**Frontend (React)**
```bash
cd frontend
npm install
npm run dev
# apri http://localhost:5173 (Vite usa una porta diversa da Docker in dev)
```

## Variabili d'ambiente

Tutte documentate in [`.env.example`](./.env.example). Le principali:

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | Chiave API OpenAI, usata dal Backend (LLM) e dal RAG (embeddings) |
| `OPENAI_MODEL` | no | Modello di default (`gpt-4o-mini`) |
| `DATA_AGENT_URL` | no (default Docker) | URL interno del microservizio Python |
| `CHROMADB_URL` | no (default Docker) | URL interno di ChromaDB |
| `SMTP_*` / `EMAIL_FROM` | no | Solo se si vuole testare l'invio reale dei report via email |
| `MARKETAUX_API_KEY` | no | Solo per notizie di mercato reali (senza, usa dati mock) |
| `DOMAIN` | no | Solo per il deploy in produzione su VPS (vedi sotto) |

## Test automatici

```bash
# Data Agent (Pytest)
cd data_agent
pip install -r requirements-dev.txt
pytest tests/ -v

# Backend (Jest)
cd backend
npm install
npm test
```

Entrambe le suite sono eseguite automaticamente dalla pipeline CI
(`.github/workflows/ci.yml`) ad ogni push/PR.

## Notebook di prototipazione

Nella cartella [`notebooks/`](./notebooks/) trovi due notebook Jupyter, come
suggerito dal brief per la fase di prototipazione:

1. `01_generazione_dataset_e_knowledge_base.ipynb` — genera da zero il
   database SQLite e i documenti della Knowledge Base
2. `02_data_agent_prototyping.ipynb` — prototipa la pipeline di analisi
   (cleaning, query, grafici, sintesi) prima della sua integrazione nel
   microservizio FastAPI

Dettagli in [`notebooks/README.md`](./notebooks/README.md).

## Deploy in produzione

Due percorsi documentati e pronti all'uso:

- **Render** (consigliato per una demo pubblica gratuita): `render.yaml`
  contiene il Blueprint completo dei 4 servizi — vedi i commenti nel file per
  i passaggi.
- **VPS con Docker Compose + HTTPS automatico**: `docker-compose.prod.yml`
  aggiunge un reverse proxy Caddy con certificato Let's Encrypt automatico.
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
  ```
  Richiede un dominio puntato all'IP del server e `DOMAIN=tuodominio.it` nel
  `.env`. Vedi i commenti in `docker-compose.prod.yml` e `Caddyfile` per i
  dettagli (firewall, DNS, ecc.).

GitHub Pages **non è supportato** per l'intera applicazione: ospita solo
contenuti statici e non può eseguire i tre backend (Node.js, Python,
ChromaDB). È possibile pubblicare lì solo il frontend, puntandolo a un
backend ospitato separatamente tramite `VITE_API_BASE_URL` (vedi
`frontend/.env.example`).

## Sicurezza

- Nessuna API key hardcoded nel codice sorgente: tutte le credenziali via
  variabili d'ambiente, `.env` escluso dal version control (`.gitignore`)
- Validazione SQL lato Data Agent: solo query `SELECT`/`WITH`, bloccati
  `DROP/DELETE/UPDATE/INSERT/ALTER/ATTACH/PRAGMA` e le query multi-statement
  (`agent_engine.py::validate_readonly_select`)
- Connessione SQLite aperta in sola lettura (`mode=ro`)
- Guardrail human-in-the-loop sull'invio email: nessun invio automatico senza
  conferma esplicita dell'utente
- Sanitizzazione dei nomi file in upload (anti path-traversal)
- In produzione: porte interne vincolate a `127.0.0.1`, unico punto d'accesso
  pubblico tramite reverse proxy HTTPS

Dettagli completi in [`COMPLIANCE.md`](./COMPLIANCE.md#sicurezza-oltre-il-minimo-richiesto).

## Troubleshooting

**"Errore di comunicazione con l'Orchestratore Backend" in chat**
Il messaggio ora include un campo "Dettaglio" con l'errore reale (es. chiave
OpenAI non valida, data_agent non raggiungibile). Controlla anche i log del
container backend: `docker compose logs -f backend`.

**Il RAG risponde sempre con la lista statica dei documenti**
Verifica che ChromaDB sia in esecuzione (`docker compose ps`) e che
`OPENAI_API_KEY` sia valida (serve anche per generare gli embedding, non solo
per le risposte del modello).

**"Request failed with status code 500" sulle analisi dati**
Controlla i log del container `data_agent` (`docker compose logs -f
data_agent`): da quando è stato corretto il bug di gestione errori, il
dettaglio SQL esatto (es. colonna inesistente) compare sia nei log sia
nell'Observation mostrata in chat durante lo streaming del ragionamento.

**Le porte 5000/8000/8001 non sono raggiungibili da fuori Docker**
È voluto: dalla versione con hardening di sicurezza sono vincolate a
`127.0.0.1`. Solo il frontend (porta 3000, che proxa `/api` e `/static`
internamente) va esposto.

---

## Licenza

Distribuito sotto licenza MIT — vedi [`LICENSE`](./LICENSE).
