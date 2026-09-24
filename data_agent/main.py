import os
import time
import hashlib
import asyncio
import glob
from fastapi import FastAPI, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from agent_engine import DataAgentEngine, UnsafeQueryError, QueryTimeoutError

# Inizializzazione applicazione FastAPI
app = FastAPI(
    title="NovaBanca Risk Data Agent API",
    description="Microservizio per l'esecuzione di query SQL, data cleaning con Pandas e generazione grafici con Seaborn.",
    version="1.0.0"
)

# Configurazione CORS per permettere le chiamate dal Backend Node.js e Frontend React.
#
# Feedback Lorenzo: allow_origins=["*"] insieme ad allow_credentials=True è una
# combinazione tecnicamente inconsistente — per il Fetch/CORS spec, i browser
# rifiutano il wildcard "*" quando sono presenti credenziali (cookie, header di
# autorizzazione con credenziali), quindi la protezione CORS risultava di fatto
# nulla. Questo servizio non usa cookie né sessioni basate su credenziali (le
# uniche chiamate sono JSON puro, server-to-server dal Backend Node.js e, per le
# immagini dei grafici, dal browser tramite tag <img> che non invia credenziali),
# quindi allow_credentials=False è la configurazione corretta.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Montaggio della directory dei file statici per servire i grafici PNG generati
CHARTS_DIR = os.path.abspath("static/charts")
os.makedirs(CHARTS_DIR, exist_ok=True)
app.mount("/static/charts", StaticFiles(directory=CHARTS_DIR), name="charts")

# Inizializzazione dell'Engine
DB_PATH = os.getenv("DB_PATH", "database/novabanca_core_banking.db")
agent_engine = DataAgentEngine(db_path=DB_PATH)


# -----------------------------------------------------------------------------
# PULIZIA PERIODICA DEI GRAFICI (Feedback Daniele + Lorenzo)
# -----------------------------------------------------------------------------
# I PNG generati da ogni analisi si accumulano su disco senza mai essere
# rimossi. In esecuzione prolungata il volume si riempie. Una pulizia periodica
# in background rimuove i file più vecchi di CHART_MAX_AGE_HOURS.
CHART_MAX_AGE_HOURS = 24
CHART_CLEANUP_INTERVAL_SECONDS = 3600  # ogni ora


def cleanup_old_charts():
    now = time.time()
    max_age_seconds = CHART_MAX_AGE_HOURS * 3600
    removed = 0
    for filepath in glob.glob(os.path.join(CHARTS_DIR, "*.png")):
        try:
            if now - os.path.getmtime(filepath) > max_age_seconds:
                os.remove(filepath)
                removed += 1
        except OSError:
            pass  # file già rimosso da un'altra esecuzione concorrente, ignora
    if removed:
        print(f"[Chart Cleanup] Rimossi {removed} grafici più vecchi di {CHART_MAX_AGE_HOURS}h.")


async def _periodic_chart_cleanup():
    while True:
        await asyncio.sleep(CHART_CLEANUP_INTERVAL_SECONDS)
        cleanup_old_charts()


@app.on_event("startup")
async def on_startup():
    cleanup_old_charts()  # pulizia immediata all'avvio, poi ogni ora in background
    asyncio.create_task(_periodic_chart_cleanup())


# -----------------------------------------------------------------------------
# CACHE IN-MEMORY SU /api/analyze (Feedback Daniele: caching per domande ripetute)
# -----------------------------------------------------------------------------
# Daniele suggeriva Redis. Scelta consapevole per questa consegna: una cache in
# memoria con TTL breve copre lo stesso caso d'uso pratico (utenti che pongono
# la stessa domanda, che l'LLM traduce quasi sempre nella stessa query SQL)
# senza aggiungere un nuovo servizio/punto di guasto a ridosso della scadenza.
# Redis diventa necessario solo con più istanze del Data Agent in parallelo
# (cache condivisa tra processi): con un solo processo (il caso attuale, anche
# in deploy) una cache locale è equivalente in efficacia e più semplice.
_analyze_cache: Dict[str, Dict[str, Any]] = {}
ANALYZE_CACHE_TTL_SECONDS = 120
ANALYZE_CACHE_MAX_ENTRIES = 200


def _cache_key(request: "AnalyzeRequest") -> str:
    raw = f"{request.query_sql}|{request.chart_type}|{request.chart_title}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_cached_analysis(key: str):
    entry = _analyze_cache.get(key)
    if not entry:
        return None
    if time.time() - entry["timestamp"] > ANALYZE_CACHE_TTL_SECONDS:
        del _analyze_cache[key]
        return None
    return entry["response"]


def _store_cached_analysis(key: str, response: "AnalyzeResponse"):
    if len(_analyze_cache) >= ANALYZE_CACHE_MAX_ENTRIES:
        oldest_key = min(_analyze_cache, key=lambda k: _analyze_cache[k]["timestamp"])
        del _analyze_cache[oldest_key]
    _analyze_cache[key] = {"response": response, "timestamp": time.time()}


# -----------------------------------------------------------------------------
# MODELLI DI RICHIESTA E RISPOSTA (Pydantic Schema)
# -----------------------------------------------------------------------------
class AnalyzeRequest(BaseModel):
    query_sql: str = Field(..., description="Query SQL da eseguire sul database SQLite")
    chart_type: Optional[str] = Field(default="bar", description="Tipo di grafico: bar, hist, box, pie, line")
    chart_title: Optional[str] = Field(default="Analisi Rischio Credito", description="Titolo del grafico")

class AnalyzeResponse(BaseModel):
    status: str
    row_count: int
    summary_text: str
    chart_url: Optional[str] = None
    data_preview: list[Dict[str, Any]]


# -----------------------------------------------------------------------------
# ENDPOINT DI LIVENESS & HEALTH CHECK
# -----------------------------------------------------------------------------
@app.get("/health", status_code=status.HTTP_200_OK)
def health_check():
    return {"status": "ok", "service": "data_agent"}


# -----------------------------------------------------------------------------
# ENDPOINT DASHBOARD: GET /api/kpis
# -----------------------------------------------------------------------------
@app.get("/api/kpis", status_code=status.HTTP_200_OK)
def get_kpis():
    """
    Restituisce un set di KPI aggregati sull'intero portafoglio crediti,
    da mostrare come card executive sempre visibili nella dashboard React.
    """
    try:
        kpis = agent_engine.compute_kpis()
        return {"status": "success", "kpis": kpis}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Errore durante il calcolo dei KPI: {str(e)}"
        )


# -----------------------------------------------------------------------------
# ENDPOINT PRINCIPALE: /api/analyze
# -----------------------------------------------------------------------------
@app.post("/api/analyze", response_model=AnalyzeResponse, status_code=status.HTTP_200_OK)
def analyze_data(request: AnalyzeRequest):
    """
    Riceve la query SQL dall'Orchestratore Node.js, la esegue con JOIN, effettua il data cleaning
    tramite Pandas e genera facoltativamente un grafico PNG renderizzato via URL statico.
    """
    cache_key = _cache_key(request)
    cached_response = _get_cached_analysis(cache_key)
    if cached_response is not None:
        return cached_response

    try:
        # 1. Esecuzione Query SQL e Data Cleaning automatico con Pandas
        cleaned_df = agent_engine.execute_query(request.query_sql)
        row_count = len(cleaned_df)

        if row_count == 0:
            response = AnalyzeResponse(
                status="success",
                row_count=0,
                summary_text="La query non ha restituito alcun record.",
                chart_url=None,
                data_preview=[]
            )
            _store_cached_analysis(cache_key, response)
            return response

        # 2. Generazione del grafico se richiesto
        chart_filename = f"chart_{os.urandom(4).hex()}.png"
        chart_file_path = os.path.join(CHARTS_DIR, chart_filename)

        agent_engine.generate_chart(
            df=cleaned_df,
            chart_type=request.chart_type,
            title=request.chart_title,
            output_path=chart_file_path
        )

        chart_url = f"/static/charts/{chart_filename}"

        # 3. Creazione del riassunto testuale con statistiche reali (non solo il conteggio righe)
        preview_data = cleaned_df.head(5).to_dict(orient="records")
        summary = agent_engine.generate_summary(cleaned_df)

        response = AnalyzeResponse(
            status="success",
            row_count=row_count,
            summary_text=summary,
            chart_url=chart_url,
            data_preview=preview_data
        )
        _store_cached_analysis(cache_key, response)
        return response

    except UnsafeQueryError as e:
        # Query bloccata dal validatore di sicurezza: 400 esplicito, cosi'
        # il ReAct Agent capisce che deve riformulare la query, non ritentare uguale
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Query SQL rifiutata per motivi di sicurezza: {str(e)}"
        )

    except QueryTimeoutError as e:
        # Query troppo lenta/costosa, interrotta dal timeout (protezione DoS/OOM):
        # 408 Request Timeout è più preciso di un 500 generico
        raise HTTPException(
            status_code=status.HTTP_408_REQUEST_TIMEOUT,
            detail=str(e)
        )

    except ValueError as e:
        # Sollevato da generate_chart quando chart_type e colonne disponibili sono
        # incompatibili in modo non risolvibile automaticamente (es. hist senza
        # alcuna colonna numerica): 422, cosi' l'agente capisce di dover cambiare
        # chart_type o la query, non solo ritentare
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e)
        )

    except Exception as e:
        # IMPORTANTE: questo except cattura ORA anche gli errori SQL veri e propri
        # (colonna inesistente, JOIN sbagliato, errore di sintassi...), che prima
        # sfuggivano a entrambi i try/except e arrivavano al chiamante come un 500
        # "nudo" senza alcun dettaglio. Restituire qui il messaggio reale di SQLite
        # (es. "no such column: p.Flag_Default_12M") è ciò che permette al ReAct
        # Self-Correction Loop dell'Orchestrator Node.js di far RIFORMULARE la query
        # all'LLM nello stesso turno, invece di arrendersi con un errore generico.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Errore durante l'esecuzione del Data Agent: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)