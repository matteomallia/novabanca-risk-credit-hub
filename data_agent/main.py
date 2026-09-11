import os
from fastapi import FastAPI, HTTPException, status
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from agent_engine import DataAgentEngine, UnsafeQueryError

# Inizializzazione applicazione FastAPI
app = FastAPI(
    title="NovaBanca Risk Data Agent API",
    description="Microservizio per l'esecuzione di query SQL, data cleaning con Pandas e generazione grafici con Seaborn.",
    version="1.0.0"
)

# Configurazione CORS per permettere le chiamate dal Backend Node.js e Frontend React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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
    try:
        # 1. Esecuzione Query SQL e Data Cleaning automatico con Pandas
        cleaned_df = agent_engine.execute_query(request.query_sql)
        row_count = len(cleaned_df)

        if row_count == 0:
            return AnalyzeResponse(
                status="success",
                row_count=0,
                summary_text="La query non ha restituito alcun record.",
                chart_url=None,
                data_preview=[]
            )

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

        return AnalyzeResponse(
            status="success",
            row_count=row_count,
            summary_text=summary,
            chart_url=chart_url,
            data_preview=preview_data
        )

    except UnsafeQueryError as e:
        # Query bloccata dal validatore di sicurezza: 400 esplicito, cosi'
        # il ReAct Agent capisce che deve riformulare la query, non ritentare uguale
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Query SQL rifiutata per motivi di sicurezza: {str(e)}"
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