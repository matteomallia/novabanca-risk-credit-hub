import os
import re
import time
import sqlite3
import pandas as pd
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
import seaborn as sns
from pandas.errors import DatabaseError as PandasDatabaseError


class UnsafeQueryError(ValueError):
    """Sollevata quando la query SQL generata dall'agente non è una SELECT di sola lettura."""
    pass


class QueryTimeoutError(RuntimeError):
    """Sollevata quando una query supera il tempo massimo consentito (protezione DoS/OOM)."""
    pass


# Parole chiave che non devono MAI comparire in una query eseguita da questo servizio:
# il Data Agent deve poter solo LEGGERE dati, mai modificarli o alterare lo schema.
# NOTA (feedback Lorenzo): questa blacklist è una difesa SECONDARIA, fragile per natura
# (una blacklist testuale si può sempre aggirare con varianti sintattiche). La difesa
# PRIMARIA è la connessione SQLite aperta in mode=ro in get_connection(), che rende
# impossibile qualunque scrittura a livello di driver/filesystem, indipendentemente
# da cosa contiene la query.
_FORBIDDEN_KEYWORDS = re.compile(
    r"\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|PRAGMA|REPLACE|VACUUM)\b",
    re.IGNORECASE
)

_LIMIT_PATTERN = re.compile(r"\bLIMIT\s+\d+", re.IGNORECASE)

# Cap di sicurezza sulle righe restituite: protegge da CROSS JOIN accidentali o query
# malformate generate dall'LLM che altrimenti materializzerebbero l'intero result set
# in RAM tramite pd.read_sql_query. Iniettato come LIMIT SQL (non un filtro post-hoc),
# cosi' agisce direttamente a livello di motore SQLite prima del trasferimento dati.
MAX_RESULT_ROWS = 5000

# Timeout massimo per singola query (secondi): protegge da query lente/infinite
# (es. CTE ricorsive malformate) anche in sola lettura.
MAX_QUERY_SECONDS = 5


def validate_readonly_select(query: str) -> str:
    """
    Consente l'esecuzione solo di query SELECT single-statement, in sola lettura.
    Solleva UnsafeQueryError per qualsiasi tentativo di modifica dei dati o dello schema,
    per query multi-statement (separate da ';'), o per CTE ricorsive (WITH RECURSIVE).
    """
    cleaned = query.strip().rstrip(';').strip()

    if not cleaned:
        raise UnsafeQueryError("Query SQL vuota.")

    # Blocca query multi-statement (es. "SELECT ...; DROP TABLE ...")
    if ';' in cleaned:
        raise UnsafeQueryError("Sono ammesse solo query singole: rimuovere i ';' interni.")

    if not re.match(r"^(SELECT|WITH)\b", cleaned, re.IGNORECASE):
        raise UnsafeQueryError("Sono ammesse esclusivamente query di sola lettura (SELECT / WITH ... SELECT).")

    # Feedback Lorenzo: WITH RECURSIVE è ammesso dalla regola sopra (inizia per WITH),
    # ma una CTE ricorsiva malformata (o generata da un LLM senza condizione di uscita
    # corretta) può girare indefinitamente anche in sola lettura. Non serve alle analisi
    # di questo progetto: la neghiamo esplicitamente invece di fidarci solo del LIMIT.
    if re.match(r"^WITH\s+RECURSIVE\b", cleaned, re.IGNORECASE):
        raise UnsafeQueryError(
            "Le CTE ricorsive (WITH RECURSIVE) non sono consentite: possono causare loop "
            "incontrollati o esaurimento di memoria. Usa una query SELECT/WITH non ricorsiva."
        )

    if _FORBIDDEN_KEYWORDS.search(cleaned):
        raise UnsafeQueryError(
            "La query contiene un comando non consentito (es. DROP/DELETE/UPDATE/INSERT/ALTER/ATTACH/PRAGMA). "
            "Il Data Agent può solo leggere i dati, non modificarli."
        )

    # Feedback Lorenzo: nessun LIMIT esplicito richiesto significa che un CROSS JOIN
    # accidentale (o una query semplicemente troppo ampia) materializzerebbe l'intero
    # result set in RAM via pd.read_sql_query. Se la query non ha gia' un LIMIT, lo
    # iniettiamo qui, a livello di motore SQLite: oltre a limitare la RAM usata, per una
    # eventuale CTE ricorsiva questo fa si' che SQLite interrompa la ricorsione non
    # appena il LIMIT esterno è soddisfatto (comportamento nativo di SQLite).
    if not _LIMIT_PATTERN.search(cleaned):
        cleaned = f"{cleaned} LIMIT {MAX_RESULT_ROWS}"

    return cleaned

# Configurazione backend headless per Matplotlib (evita errori in container Docker senza display GUI)
matplotlib.use('Agg')

# Stile visivo aziendale NovaBanca per i grafici Seaborn
sns.set_theme(style="whitegrid")
plt.rcParams.update({
    'font.size': 10,
    'axes.labelsize': 11,
    'axes.titlesize': 12,
    'xtick.labelsize': 9,
    'ytick.labelsize': 9,
    'figure.titlesize': 14
})

COLOR_PRIMARY = "#005A9C"    # Blu NovaBanca
COLOR_SECONDARY = "#FF6600"  # Arancio Corporate
COLOR_DANGER = "#D9534F"     # Rosso Rischio / Default


def _pick_chart_columns(df: pd.DataFrame, chart_type: str) -> dict:
    """
    Feedback Lorenzo: chart_type e query SQL sono scelti dall'LLM in modo indipendente,
    quindi possono non essere coerenti (es. 'hist' su una colonna testuale, o 'bar' con
    le colonne in un ordine che non corrisponde a "etichetta poi valore"). La versione
    precedente si fidava ciecamente di df.columns[0]/[1], causando errori o grafici privi
    di senso. Questa funzione verifica il TIPO reale dei dati (numerico vs testuale) e
    sceglie/corregge le colonne di conseguenza, con un fallback sempre valido (conteggio
    delle occorrenze) quando non esiste alcuna colonna numerica da usare come valore.
    """
    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    other_cols = [c for c in df.columns if c not in numeric_cols]

    if chart_type == 'hist':
        if numeric_cols:
            return {'value_col': numeric_cols[0]}
        raise ValueError(
            f"Impossibile generare un istogramma: nessuna colonna numerica nel risultato "
            f"(colonne disponibili: {', '.join(df.columns)}). Usa 'bar' per dati categoriali "
            "o modifica la query per includere una colonna numerica."
        )

    # bar / pie / line: serve una colonna "etichetta" (categoriale) e una "valore" (numerica)
    if len(df.columns) < 2:
        df_reset = df.reset_index()
        return {'label_col': df_reset.columns[0], 'value_col': df_reset.columns[1], 'df': df_reset}

    if numeric_cols and other_cols:
        # Caso più comune: una colonna testuale + una numerica, in QUALSIASI ordine le
        # restituisca la query. Usiamo sempre quella numerica come valore.
        return {'label_col': other_cols[0], 'value_col': numeric_cols[0]}

    if len(numeric_cols) >= 2:
        # Entrambe numeriche (es. due metriche): la prima resta l'asse delle etichette
        return {'label_col': numeric_cols[0], 'value_col': numeric_cols[1]}

    # Nessuna colonna numerica: fallback sempre valido, il conteggio delle occorrenze
    # della prima colonna (es. quante pratiche per Stato_Pratica)
    return {'label_col': df.columns[0], 'value_col': None, 'count_mode': True}


class DataAgentEngine:
    KPI_CACHE_TTL_SECONDS = 60

    def __init__(self, db_path: str = "database/novabanca_core_banking.db"):
        """
        Inizializza il motore d'analisi collegandolo al database SQLite relazionale.
        """
        self.db_path = db_path
        if not os.path.exists(self.db_path):
            raise FileNotFoundError(f"Database SQLite non trovato nel percorso: {self.db_path}")
        self._kpi_cache = {"data": None, "timestamp": 0}

    def get_connection(self):
        """
        Apre una connessione in sola lettura verso il DB SQLite (uri=True + mode=ro),
        cosi' anche a livello di filesystem/driver risulta impossibile scrivere,
        indipendentemente dal contenuto della query.
        """
        uri_path = f"file:{os.path.abspath(self.db_path)}?mode=ro"
        return sqlite3.connect(uri_path, uri=True)

    def _install_query_timeout(self, conn, max_seconds: float = MAX_QUERY_SECONDS):
        """
        Feedback Lorenzo: il LIMIT iniettato in validate_readonly_select limita le righe
        RESTITUITE, ma una query comunque costosa (es. un JOIN incrociato su condizioni
        poco selettive) può impiegare molto tempo PRIMA di arrivare a quel LIMIT. Il
        progress_handler di SQLite viene richiamato periodicamente durante l'esecuzione:
        se il tempo massimo è superato, restituire un valore diverso da zero fa
        interrompere la query in corso con un OperationalError("interrupted").
        """
        start = time.monotonic()

        def handler():
            return 1 if (time.monotonic() - start) > max_seconds else 0

        # n=200 (ridotto da 1000 dopo un test CI fallito): SQLite richiama l'handler
        # ogni 200 "passi" della sua virtual machine. Un valore piu' basso rende il
        # timeout piu' reattivo/affidabile anche su query moderatamente piccole,
        # con un overhead trascurabile per le query legittime.
        conn.set_progress_handler(handler, 200)

    # -------------------------------------------------------------------------
    # 1. CLEANING ENGINE (Pandas)
    # -------------------------------------------------------------------------
    def clean_dataset(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Motore autonomo di Data Cleaning con Pandas per sanare il 10-12% di dati sporchi:
        - Conversione reddito stringa ("45.000 €") -> float numerico
        - Gestione dei valori mancanti (NaN) su Età e Reddito
        - Filtraggio degli outlier su Credit Score (valori ammissibili 300-850)
        - Stripping degli spazi superflui nelle categorie professionali
        """
        df = df.copy()

        # 1. Stripping stringhe nelle colonne di tipo testo
        str_cols = df.select_dtypes(include=['object', 'string']).columns
        for col in str_cols:
            df[col] = df[col].astype(str).str.strip()

        # 2. Cleaning Reddito_Annuale_EUR (trasforma "45.000 €" o "None" in float)
        if 'Reddito_Annuale_EUR' in df.columns:
            df['Reddito_Annuale_EUR'] = (
                df['Reddito_Annuale_EUR']
                .astype(str)
                .str.replace('€', '', regex=False)
                .str.replace('.', '', regex=False)
                .str.replace(',', '.', regex=False)
                .str.strip()
            )
            df['Reddito_Annuale_EUR'] = pd.to_numeric(df['Reddito_Annuale_EUR'], errors='coerce')
            
            # Imputazione dinamica NaN con la mediana di categoria
            if df['Reddito_Annuale_EUR'].isnull().any():
                df['Reddito_Annuale_EUR'] = df['Reddito_Annuale_EUR'].fillna(
                    df['Reddito_Annuale_EUR'].median()
                )

        # 3. Cleaning Eta_Cliente
        if 'Eta_Cliente' in df.columns:
            df['Eta_Cliente'] = pd.to_numeric(df['Eta_Cliente'], errors='coerce')
            if df['Eta_Cliente'].isnull().any():
                df['Eta_Cliente'] = df['Eta_Cliente'].fillna(df['Eta_Cliente'].median())

        # 4. Outlier Removal su Credit_Score_Interno (range standard 300-850)
        # Feedback Daniele: la versione precedente usava un lambda con confronti diretti
        # (x < 300 or x > 850), fragile per natura — se x fosse un vero None (non NaN),
        # il confronto solleverebbe TypeError. pd.to_numeric(errors='coerce') converte
        # già tutto in NaN prima di questo punto, ma il pattern restava pericoloso per
        # costruzione. Qui uso mascheramento booleano vettoriale, che pandas gestisce
        # nativamente e in modo sicuro anche in presenza di NaN (nessuna eccezione
        # possibile), oltre ad essere più idiomatico e più veloce di un .apply().
        if 'Credit_Score_Interno' in df.columns:
            df['Credit_Score_Interno'] = pd.to_numeric(df['Credit_Score_Interno'], errors='coerce')
            out_of_range = (df['Credit_Score_Interno'] < 300) | (df['Credit_Score_Interno'] > 850)
            df.loc[out_of_range, 'Credit_Score_Interno'] = np.nan
            df['Credit_Score_Interno'] = df['Credit_Score_Interno'].fillna(df['Credit_Score_Interno'].median())

        return df

    # -------------------------------------------------------------------------
    # 2. EXECUTE SQL QUERY WITH JOIN & AUTO-CLEANING
    # -------------------------------------------------------------------------
    def execute_query(self, query: str) -> pd.DataFrame:
        """
        Esegue una query SQL multi-tabella sul DB relazionale e passa il risultato
        al motore di Data Cleaning prima di restituire il DataFrame pulito.
        """
        safe_query = validate_readonly_select(query)
        conn = self.get_connection()
        try:
            self._install_query_timeout(conn)
            try:
                raw_df = pd.read_sql_query(safe_query, conn)
            except (sqlite3.OperationalError, PandasDatabaseError) as e:
                # IMPORTANTE: pandas avvolge l'OperationalError di sqlite3 in un proprio
                # pandas.errors.DatabaseError (non lo ripropaga direttamente) — va quindi
                # catturato esplicitamente anche questo, altrimenti l'interruzione della
                # query per timeout risulterebbe un'eccezione non gestita.
                if 'interrupted' in str(e).lower():
                    raise QueryTimeoutError(
                        f"La query ha superato il tempo massimo consentito ({MAX_QUERY_SECONDS}s) "
                        "ed è stata interrotta per evitare un uso eccessivo di risorse. Semplifica "
                        "la query (meno JOIN, condizioni più selettive nel WHERE)."
                    ) from e
                raise
            finally:
                conn.set_progress_handler(None, 0)

            cleaned_df = self.clean_dataset(raw_df)
            return cleaned_df
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 2b. NARRATIVE INSIGHT ENGINE
    # -------------------------------------------------------------------------
    def generate_summary(self, df: pd.DataFrame) -> str:
        """
        Traduce i numeri grezzi del DataFrame in una sintesi testuale con statistiche
        reali (non solo il conteggio righe), cosi' che il ReAct Agent possa costruire
        una risposta finale davvero informativa per il decision maker.
        """
        row_count = len(df)
        if row_count == 0:
            return "La query non ha restituito alcun record."

        parts = [f"Analisi condotta su {row_count} record."]

        numeric_cols = df.select_dtypes(include=[np.number]).columns
        categorical_cols = df.select_dtypes(include=['object', 'string']).columns

        # Statistiche descrittive sulle colonne numeriche (max 3 per non appesantire il testo)
        for col in list(numeric_cols)[:3]:
            series = df[col].dropna()
            if series.empty:
                continue
            parts.append(
                f"'{col}': media {series.mean():,.2f}, minimo {series.min():,.2f}, "
                f"massimo {series.max():,.2f}, totale {series.sum():,.2f}."
            )

        # Distribuzione della categoria più frequente (utile per colonne come Stato_Pratica, Area_Geografica...)
        for col in list(categorical_cols)[:2]:
            counts = df[col].value_counts()
            if not counts.empty:
                top_value = counts.index[0]
                top_pct = (counts.iloc[0] / row_count) * 100
                parts.append(
                    f"Valore più frequente in '{col}': '{top_value}' ({top_pct:.1f}% dei record)."
                )

        return " ".join(parts)

    # -------------------------------------------------------------------------
    # 2c. KPI ENGINE (Dashboard Executive)
    # -------------------------------------------------------------------------
    def compute_kpis(self) -> list:
        """
        Calcola un set di KPI aggregati sull'intero portafoglio, da mostrare
        come card sempre visibili nella dashboard React (indipendenti dalla chat).
        Ogni query passa comunque dal validatore SELECT-only per coerenza di sicurezza.

        Feedback Lorenzo: questo metodo apriva una connessione e lanciava 5 query
        ad ogni singola GET /api/kpis — se la dashboard fa polling, martella SQLite
        di continuo per dati che cambiano raramente. Cache in memoria con TTL breve
        (60s): niente nuova infrastruttura, ma le richieste ravvicinate (tipico di un
        polling o di più utenti che aprono la dashboard nello stesso minuto) riusano
        lo stesso risultato invece di ricalcolarlo da zero ogni volta.
        """
        now = time.monotonic()
        if self._kpi_cache["data"] is not None and (now - self._kpi_cache["timestamp"]) < self.KPI_CACHE_TTL_SECONDS:
            return self._kpi_cache["data"]

        conn = self.get_connection()
        try:
            def scalar(query, default=0):
                safe = validate_readonly_select(query)
                df = pd.read_sql_query(safe, conn)
                if df.empty or pd.isna(df.iloc[0, 0]):
                    return default
                return df.iloc[0, 0]

            total_exposure = scalar(
                "SELECT SUM(Importo_Richiesto_EUR) FROM T_PRATICHE_FIDO"
            )
            avg_credit_score = scalar(
                "SELECT AVG(Credit_Score_Interno) FROM T_PRATICHE_FIDO "
                "WHERE Credit_Score_Interno BETWEEN 300 AND 850"
            )
            total_pratiche = scalar("SELECT COUNT(*) FROM T_PRATICHE_FIDO")
            default_pratiche = scalar(
                "SELECT COUNT(DISTINCT ID_Pratica) FROM T_PERFORMANCE_AMORT "
                "WHERE Flag_Default_12M = 1"
            )
            total_filiali = scalar("SELECT COUNT(*) FROM T_FILIALI")

            npl_ratio = (default_pratiche / total_pratiche * 100) if total_pratiche else 0

            result = [
                {"label": "Esposizione Totale Fidi", "value": round(float(total_exposure), 2), "unit": "EUR", "icon": "landmark"},
                {"label": "NPL Ratio", "value": round(float(npl_ratio), 2), "unit": "%", "icon": "trending-down"},
                {"label": "Credit Score Medio", "value": round(float(avg_credit_score), 1), "unit": "pt", "icon": "gauge"},
                {"label": "Pratiche Totali", "value": int(total_pratiche), "unit": "", "icon": "file-stack"},
                {"label": "Filiali Attive", "value": int(total_filiali), "unit": "", "icon": "building"}
            ]
            self._kpi_cache = {"data": result, "timestamp": now}
            return result
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 3. PLOTTING ENGINE (Seaborn & Matplotlib)
    # -------------------------------------------------------------------------
    def generate_chart(self, df: pd.DataFrame, chart_type: str, title: str, output_path: str) -> str:
        """
        Genera grafici ad alta risoluzione (300 DPI) e li salva in formato PNG.
        Chart Types supportati: 'bar', 'hist', 'box', 'pie', 'line'.
        Le colonne da usare sono scelte/corrette da _pick_chart_columns() in base al
        tipo di dato reale (numerico vs testuale), non solo alla posizione in df.columns.
        """
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        fig, ax = plt.subplots(figsize=(9, 5))

        if chart_type == 'hist':
            picked = _pick_chart_columns(df, 'hist')
            sns.histplot(data=df, x=picked['value_col'], kde=True, color=COLOR_PRIMARY, ax=ax, bins=25)

        elif chart_type == 'box':
            numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
            other_cols = [c for c in df.columns if c not in numeric_cols]
            if numeric_cols and other_cols:
                x_col, y_col = other_cols[0], numeric_cols[0]
            elif len(numeric_cols) >= 2:
                x_col, y_col = numeric_cols[0], numeric_cols[1]
            elif numeric_cols:
                x_col = y_col = numeric_cols[0]
            else:
                raise ValueError(
                    f"Impossibile generare un box plot: nessuna colonna numerica nel "
                    f"risultato (colonne disponibili: {', '.join(df.columns)})."
                )
            sns.boxplot(data=df, x=x_col, y=y_col, hue=x_col, palette="Set2", legend=False, ax=ax)
            ax.set_xticklabels(ax.get_xticklabels(), rotation=25, ha='right')

        elif chart_type == 'pie':
            picked = _pick_chart_columns(df, 'pie')
            df = picked.get('df', df)
            if picked.get('count_mode'):
                counts = df[picked['label_col']].value_counts()
                ax.pie(counts.values, labels=counts.index, autopct='%1.1f%%',
                       colors=[COLOR_PRIMARY, COLOR_SECONDARY, COLOR_DANGER, '#6c757d'], startangle=140)
            else:
                ax.pie(df[picked['value_col']], labels=df[picked['label_col']], autopct='%1.1f%%',
                       colors=[COLOR_PRIMARY, COLOR_SECONDARY, COLOR_DANGER, '#6c757d'], startangle=140)

        elif chart_type == 'bar':
            picked = _pick_chart_columns(df, 'bar')
            df = picked.get('df', df)
            if picked.get('count_mode'):
                counts = df[picked['label_col']].value_counts().reset_index()
                counts.columns = [picked['label_col'], 'Conteggio']
                sns.barplot(data=counts, x=picked['label_col'], y='Conteggio', color=COLOR_PRIMARY, ax=ax)
            else:
                sns.barplot(data=df, x=picked['label_col'], y=picked['value_col'], color=COLOR_PRIMARY, ax=ax)
            ax.set_xticklabels(ax.get_xticklabels(), rotation=25, ha='right')

        else:  # line (default)
            picked = _pick_chart_columns(df, 'line')
            df = picked.get('df', df)
            if picked.get('count_mode'):
                counts = df[picked['label_col']].value_counts().sort_index().reset_index()
                counts.columns = [picked['label_col'], 'Conteggio']
                sns.lineplot(data=counts, x=picked['label_col'], y='Conteggio', marker='o', color=COLOR_PRIMARY, ax=ax)
            else:
                sns.lineplot(data=df, x=picked['label_col'], y=picked['value_col'], marker='o', color=COLOR_PRIMARY, ax=ax)

        ax.set_title(title, pad=15, fontweight='bold', color='#333333')
        plt.tight_layout()
        plt.savefig(output_path, dpi=300, format='png')
        plt.close(fig)

        return output_path