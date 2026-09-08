import os
import re
import sqlite3
import pandas as pd
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
import seaborn as sns


class UnsafeQueryError(ValueError):
    """Sollevata quando la query SQL generata dall'agente non è una SELECT di sola lettura."""
    pass


# Parole chiave che non devono MAI comparire in una query eseguita da questo servizio:
# il Data Agent deve poter solo LEGGERE dati, mai modificarli o alterare lo schema.
_FORBIDDEN_KEYWORDS = re.compile(
    r"\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|PRAGMA|REPLACE|VACUUM)\b",
    re.IGNORECASE
)


def validate_readonly_select(query: str) -> str:
    """
    Consente l'esecuzione solo di query SELECT single-statement, in sola lettura.
    Solleva UnsafeQueryError per qualsiasi tentativo di modifica dei dati o dello schema,
    o per query multi-statement (separate da ';').
    """
    cleaned = query.strip().rstrip(';').strip()

    if not cleaned:
        raise UnsafeQueryError("Query SQL vuota.")

    # Blocca query multi-statement (es. "SELECT ...; DROP TABLE ...")
    if ';' in cleaned:
        raise UnsafeQueryError("Sono ammesse solo query singole: rimuovere i ';' interni.")

    if not re.match(r"^(SELECT|WITH)\b", cleaned, re.IGNORECASE):
        raise UnsafeQueryError("Sono ammesse esclusivamente query di sola lettura (SELECT / WITH ... SELECT).")

    if _FORBIDDEN_KEYWORDS.search(cleaned):
        raise UnsafeQueryError(
            "La query contiene un comando non consentito (es. DROP/DELETE/UPDATE/INSERT/ALTER/ATTACH/PRAGMA). "
            "Il Data Agent può solo leggere i dati, non modificarli."
        )

    return cleaned

# Configurazione backend headless per Matplotlib (evita errori in container Docker senza display GUI)
matplotlib.use('Agg')

# Stile visivo aziendale Intesa Sanpaolo per i grafici Seaborn
sns.set_theme(style="whitegrid")
plt.rcParams.update({
    'font.size': 10,
    'axes.labelsize': 11,
    'axes.titlesize': 12,
    'xtick.labelsize': 9,
    'ytick.labelsize': 9,
    'figure.titlesize': 14
})

COLOR_PRIMARY = "#005A9C"    # Blu Intesa Sanpaolo
COLOR_SECONDARY = "#FF6600"  # Arancio Corporate
COLOR_DANGER = "#D9534F"     # Rosso Rischio / Default


class DataAgentEngine:
    def __init__(self, db_path: str = "database/intesa_core_banking.db"):
        """
        Inizializza il motore d'analisi collegandolo al database SQLite relazionale.
        """
        self.db_path = db_path
        if not os.path.exists(self.db_path):
            raise FileNotFoundError(f"Database SQLite non trovato nel percorso: {self.db_path}")

    def get_connection(self):
        """
        Apre una connessione in sola lettura verso il DB SQLite (uri=True + mode=ro),
        cosi' anche a livello di filesystem/driver risulta impossibile scrivere,
        indipendentemente dal contenuto della query.
        """
        uri_path = f"file:{os.path.abspath(self.db_path)}?mode=ro"
        return sqlite3.connect(uri_path, uri=True)

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

        # 4. Outlier Removal su Credit_Score_ISP (range standard 300-850)
        if 'Credit_Score_ISP' in df.columns:
            df['Credit_Score_ISP'] = pd.to_numeric(df['Credit_Score_ISP'], errors='coerce')
            # Clip dei valori fuori range (es. 950 o 999 portati al valore max 850)
            df['Credit_Score_ISP'] = df['Credit_Score_ISP'].apply(
                lambda x: np.nan if (x < 300 or x > 850) else x
            )
            df['Credit_Score_ISP'] = df['Credit_Score_ISP'].fillna(df['Credit_Score_ISP'].median())

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
            raw_df = pd.read_sql_query(safe_query, conn)
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
        """
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
                "SELECT AVG(Credit_Score_ISP) FROM T_PRATICHE_FIDO "
                "WHERE Credit_Score_ISP BETWEEN 300 AND 850"
            )
            total_pratiche = scalar("SELECT COUNT(*) FROM T_PRATICHE_FIDO")
            default_pratiche = scalar(
                "SELECT COUNT(DISTINCT ID_Pratica) FROM T_PERFORMANCE_AMORT "
                "WHERE Flag_Default_12M = 1"
            )
            total_filiali = scalar("SELECT COUNT(*) FROM T_FILIALI")

            npl_ratio = (default_pratiche / total_pratiche * 100) if total_pratiche else 0

            return [
                {"label": "Esposizione Totale Fidi", "value": round(float(total_exposure), 2), "unit": "EUR", "icon": "landmark"},
                {"label": "NPL Ratio", "value": round(float(npl_ratio), 2), "unit": "%", "icon": "trending-down"},
                {"label": "Credit Score Medio", "value": round(float(avg_credit_score), 1), "unit": "pt", "icon": "gauge"},
                {"label": "Pratiche Totali", "value": int(total_pratiche), "unit": "", "icon": "file-stack"},
                {"label": "Filiali Attive", "value": int(total_filiali), "unit": "", "icon": "building"}
            ]
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # 3. PLOTTING ENGINE (Seaborn & Matplotlib)
    # -------------------------------------------------------------------------
    def generate_chart(self, df: pd.DataFrame, chart_type: str, title: str, output_path: str) -> str:
        """
        Genera grafici ad alta risoluzione (300 DPI) e li salva in formato PNG.
        Chart Types supportati: 'bar', 'hist', 'box', 'pie', 'line'
        """
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        fig, ax = plt.subplots(figsize=(9, 5))

        if chart_type == 'bar':
            # Esempio: Tassi di default per area o media importi.
            # Se la query restituisce una sola colonna (es. un aggregato secco tipo
            # "SELECT COUNT(*) FROM ..."), non esiste una seconda colonna da usare
            # come asse Y: invece di andare in IndexError, usiamo l'indice di riga
            # come asse categoriale sintetico, cosi' il grafico si genera comunque.
            if len(df.columns) < 2:
                df = df.reset_index()
            x_col = df.columns[0]
            y_col = df.columns[1]
            sns.barplot(data=df, x=x_col, y=y_col, palette="Blues_d", ax=ax)
            ax.set_xticklabels(ax.get_xticklabels(), rotation=25, ha='right')

        elif chart_type == 'hist':
            # Esempio: Distribuzione dei Credit Score o dell'Età
            col = df.columns[0]
            sns.histplot(data=df, x=col, kde=True, color=COLOR_PRIMARY, ax=ax, bins=25)

        elif chart_type == 'box':
            # Esempio: Anomaly detection / Reddito per categoria
            x_col = df.columns[0]
            y_col = df.columns[1] if len(df.columns) > 1 else df.columns[0]
            sns.boxplot(data=df, x=x_col, y=y_col, palette="Set2", ax=ax)
            ax.set_xticklabels(ax.get_xticklabels(), rotation=25, ha='right')

        elif chart_type == 'pie':
            # Esempio: Proporzione dello stato pratiche. Stessa protezione del caso 'bar'.
            if len(df.columns) < 2:
                df = df.reset_index()
            labels_col = df.columns[0]
            values_col = df.columns[1]
            ax.pie(df[values_col], labels=df[labels_col], autopct='%1.1f%%',
                   colors=[COLOR_PRIMARY, COLOR_SECONDARY, COLOR_DANGER, '#6c757d'], startangle=140)

        else: # Default Line plot — stessa protezione
            if len(df.columns) < 2:
                df = df.reset_index()
            x_col = df.columns[0]
            y_col = df.columns[1]
            sns.lineplot(data=df, x=x_col, y=y_col, marker='o', color=COLOR_PRIMARY, ax=ax)

        ax.set_title(title, pad=15, fontweight='bold', color='#333333')
        plt.tight_layout()
        plt.savefig(output_path, dpi=300, format='png')
        plt.close(fig)

        return output_path