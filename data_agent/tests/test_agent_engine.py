"""
Test automatici per DataAgentEngine e il validatore di sicurezza SQL.

Esecuzione: pytest data_agent/tests/ -v
(dalla cartella data_agent/, con le dipendenze di requirements.txt installate)
"""
import os
import sys
import sqlite3
import tempfile

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent_engine import DataAgentEngine, UnsafeQueryError, QueryTimeoutError, validate_readonly_select  # noqa: E402


# -----------------------------------------------------------------------------
# FIXTURE: un mini-database SQLite temporaneo, isolato dai dati reali del progetto
# -----------------------------------------------------------------------------
@pytest.fixture
def temp_db_path():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)

    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE T_TEST (ID INTEGER, Reddito_Annuale_EUR TEXT, Eta TEXT)")
    conn.executemany(
        "INSERT INTO T_TEST VALUES (?, ?, ?)",
        [
            (1, "45.000 \u20ac", "34"),
            (2, None, "29"),          # reddito mancante -> deve essere imputato
            (3, "38.500,50", "abc"),  # eta non numerica -> deve diventare NaN -> imputata
            (4, "  52.000  \u20ac ", "41"),
        ]
    )
    conn.commit()
    conn.close()

    yield path
    os.remove(path)


@pytest.fixture
def engine(temp_db_path):
    return DataAgentEngine(db_path=temp_db_path)


# -----------------------------------------------------------------------------
# TEST: validatore SQL (sicurezza)
# -----------------------------------------------------------------------------
class TestValidateReadonlySelect:

    def test_accepts_simple_select(self):
        # Da quando e' stato aggiunto il LIMIT di sicurezza automatico (feedback
        # Lorenzo), una query senza LIMIT esplicito non resta piu' identica: viene
        # arricchita con "LIMIT 5000". Il test verifica che il contenuto originale
        # sia preservato e che il LIMIT sia stato aggiunto, non un'uguaglianza
        # esatta ormai obsoleta.
        query = validate_readonly_select("SELECT * FROM T_TEST")
        assert query.startswith("SELECT * FROM T_TEST")
        assert "LIMIT" in query

    def test_accepts_with_cte(self):
        query = validate_readonly_select("WITH x AS (SELECT 1) SELECT * FROM x")
        assert query.upper().startswith("WITH")

    def test_strips_trailing_semicolon(self):
        query = validate_readonly_select("SELECT * FROM T_TEST;")
        assert not query.endswith(";")

    @pytest.mark.parametrize("forbidden_query", [
        "DROP TABLE T_TEST",
        "DELETE FROM T_TEST",
        "UPDATE T_TEST SET ID = 1",
        "INSERT INTO T_TEST VALUES (1, '1', '1')",
        "ALTER TABLE T_TEST ADD COLUMN X TEXT",
        "ATTACH DATABASE 'x.db' AS x",
        "PRAGMA table_info(T_TEST)",
    ])
    def test_rejects_destructive_or_schema_commands(self, forbidden_query):
        with pytest.raises(UnsafeQueryError):
            validate_readonly_select(forbidden_query)

    def test_rejects_multi_statement_query(self):
        with pytest.raises(UnsafeQueryError):
            validate_readonly_select("SELECT * FROM T_TEST; DROP TABLE T_TEST")

    def test_rejects_non_select_statement(self):
        with pytest.raises(UnsafeQueryError):
            validate_readonly_select("EXPLAIN SELECT * FROM T_TEST")

    def test_rejects_empty_query(self):
        with pytest.raises(UnsafeQueryError):
            validate_readonly_select("   ")


# -----------------------------------------------------------------------------
# TEST: pipeline di Data Cleaning
# -----------------------------------------------------------------------------
class TestCleanDataset:

    def test_converts_currency_strings_to_numeric(self, engine):
        raw = pd.DataFrame({"Reddito_Annuale_EUR": ["45.000 \u20ac", "38.500,50"]})
        cleaned = engine.clean_dataset(raw)
        assert pd.api.types.is_numeric_dtype(cleaned["Reddito_Annuale_EUR"])
        assert cleaned["Reddito_Annuale_EUR"].iloc[0] == pytest.approx(45000.0)

    def test_imputes_missing_income_with_median(self, engine):
        raw = pd.DataFrame({"Reddito_Annuale_EUR": ["40.000 \u20ac", None, "60.000 \u20ac"]})
        cleaned = engine.clean_dataset(raw)
        assert cleaned["Reddito_Annuale_EUR"].isna().sum() == 0
        assert cleaned["Reddito_Annuale_EUR"].iloc[1] == pytest.approx(50000.0)

    def test_strips_whitespace_from_text_columns(self, engine):
        raw = pd.DataFrame({"Categoria_Prof": ["  Dirigente  ", "Impiegato "]})
        cleaned = engine.clean_dataset(raw)
        assert cleaned["Categoria_Prof"].iloc[0] == "Dirigente"

    def test_filters_credit_score_outliers(self, engine):
        raw = pd.DataFrame({"Credit_Score_Interno": [650, 999, 100, 720]})
        cleaned = engine.clean_dataset(raw)
        assert cleaned["Credit_Score_Interno"].between(300, 850).all()

    def test_end_to_end_query_and_clean_on_temp_db(self, engine):
        # Verifica l'intero percorso: query validata -> esecuzione -> cleaning
        df = engine.execute_query("SELECT * FROM T_TEST")
        assert len(df) == 4
        assert pd.api.types.is_numeric_dtype(df["Reddito_Annuale_EUR"])
        assert df["Reddito_Annuale_EUR"].isna().sum() == 0


# -----------------------------------------------------------------------------
# TEST: generazione della sintesi narrativa
# -----------------------------------------------------------------------------
class TestGenerateSummary:

    def test_empty_dataframe_returns_no_records_message(self, engine):
        summary = engine.generate_summary(pd.DataFrame())
        assert "alcun record" in summary.lower()

    def test_summary_includes_numeric_stats(self, engine):
        df = pd.DataFrame({"Importo_Richiesto_EUR": [10000, 20000, 30000]})
        summary = engine.generate_summary(df)
        assert "media" in summary.lower()
        assert "20" in summary  # la media (20.000) deve comparire nel testo

    def test_summary_includes_most_frequent_category(self, engine):
        df = pd.DataFrame({"Area_Geografica": ["Nord", "Nord", "Sud"]})
        summary = engine.generate_summary(df)
        assert "Nord" in summary

# -----------------------------------------------------------------------------
# TEST: generazione grafici (incluso il caso di regressione a singola colonna)
# -----------------------------------------------------------------------------
class TestGenerateChart:

    def test_single_column_dataframe_does_not_crash(self, engine, tmp_path):
        """
        Regressione: una query come 'SELECT COUNT(*) FROM T_PRATICHE_FIDO'
        restituisce un DataFrame con UNA sola colonna. Prima del fix,
        df.columns[1] lanciava 'IndexError: index 1 is out of bounds for
        axis 0 with size 1', mai catturato correttamente e che arrivava
        all'utente come errore di parsing ReAct incomprensibile.
        """
        df = pd.DataFrame({"Totale_Pratiche": [1200]})
        for chart_type in ["bar", "pie", "line"]:
            output_path = str(tmp_path / f"chart_{chart_type}.png")
            result_path = engine.generate_chart(df.copy(), chart_type, "Test", output_path)
            assert os.path.exists(result_path)

    def test_multi_column_bar_chart(self, engine, tmp_path):
        df = pd.DataFrame({"Filiale": ["A", "B", "C"], "Totale": [100, 200, 150]})
        output_path = str(tmp_path / "chart_bar.png")
        result_path = engine.generate_chart(df, "bar", "Test", output_path)
        assert os.path.exists(result_path)


# -----------------------------------------------------------------------------
# TEST: fix a seguito della revisione tecnica di Daniele Vergara e Lorenzo De Francesco
# -----------------------------------------------------------------------------
class TestSecondReviewFixes:

    def test_credit_score_with_none_does_not_raise(self, engine):
        """
        Regressione (feedback Daniele): il vecchio filtro outlier usava un
        lambda con confronti diretti (x < 300 or x > 850), fragile se x fosse
        un None reale (TypeError). Il filtro vettoriale non deve mai sollevare
        eccezioni, qualunque sia il contenuto della colonna.
        """
        raw = pd.DataFrame({"Credit_Score_Interno": [650, None, 999, np.nan, 100, 720]})
        cleaned = engine.clean_dataset(raw)  # non deve sollevare TypeError
        assert cleaned["Credit_Score_Interno"].between(300, 850).all()
        assert cleaned["Credit_Score_Interno"].isna().sum() == 0

    def test_with_recursive_is_rejected(self, engine):
        """Regressione (feedback Lorenzo): le CTE ricorsive sono un vettore di DoS."""
        with pytest.raises(UnsafeQueryError):
            engine.execute_query(
                "WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt) "
                "SELECT x FROM cnt"
            )

    def test_limit_is_injected_when_missing(self, engine):
        """Regressione (feedback Lorenzo): una query senza LIMIT non deve poter
        materializzare un result set arbitrariamente grande in RAM."""
        df = engine.execute_query("SELECT * FROM T_TEST")
        assert len(df) <= 5000  # MAX_RESULT_ROWS, qui comunque sotto soglia con soli 4 record

    def test_existing_limit_is_not_duplicated(self, engine):
        """Una query che ha già un LIMIT esplicito non deve essere alterata."""
        df = engine.execute_query("SELECT * FROM T_TEST LIMIT 2")
        assert len(df) == 2

    def test_hist_on_non_numeric_column_raises_clear_error(self, engine):
        """Regressione (feedback Lorenzo): chart_type e colonne sono scelti in
        modo indipendente dall'LLM; un mismatch deve dare un errore chiaro,
        non un crash generico né un grafico privo di senso."""
        df = pd.DataFrame({"Area_Geografica": ["Nord", "Sud", "Nord", "Centro"]})
        with pytest.raises(ValueError, match="istogramma"):
            engine.generate_chart(df, "hist", "Test", "/tmp/test_hist_invalid.png")

    def test_bar_chart_with_inverted_column_order_still_works(self, engine, tmp_path):
        """Regressione (feedback Lorenzo): la query può restituire la colonna
        numerica PRIMA di quella testuale; il grafico deve comunque avere senso
        (valore sull'asse Y numerico), non semplicemente la prima colonna."""
        df = pd.DataFrame({"Totale": [100, 200, 150], "Filiale": ["A", "B", "C"]})
        output_path = str(tmp_path / "chart_inverted.png")
        result_path = engine.generate_chart(df, "bar", "Test", output_path)
        assert os.path.exists(result_path)

    def test_bar_chart_with_only_text_column_uses_count_fallback(self, engine, tmp_path):
        """Nessuna colonna numerica disponibile: deve usare il conteggio delle
        occorrenze come fallback, invece di sollevare IndexError."""
        df = pd.DataFrame({"Stato_Pratica": ["Approvata", "Approvata", "Rifiutata"]})
        output_path = str(tmp_path / "chart_count_fallback.png")
        result_path = engine.generate_chart(df, "bar", "Test", output_path)
        assert os.path.exists(result_path)

    def test_kpi_cache_returns_cached_result_within_ttl(self):
        """Regressione (feedback Lorenzo): compute_kpis non deve rilanciare
        5 query SQL ad ogni chiamata ravvicinata (es. polling della dashboard).
        Usa il database reale (non la fixture T_TEST minimale) perché
        compute_kpis interroga lo schema completo (T_PRATICHE_FIDO, ecc.)."""
        real_db_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "database", "novabanca_core_banking.db"
        )
        if not os.path.exists(real_db_path):
            pytest.skip("Database reale non presente in questo ambiente di test")
        real_engine = DataAgentEngine(db_path=real_db_path)
        first = real_engine.compute_kpis()
        second = real_engine.compute_kpis()
        assert first == second
        assert real_engine._kpi_cache["data"] is not None

    def test_query_timeout_interrupts_slow_query(self):
        """
        Regressione (feedback Lorenzo): una query lenta deve essere interrotta,
        non eseguita fino in fondo. Usa un timeout artificialmente basso per non
        rallentare la suite (senza dover aspettare i 5s reali di produzione).

        NOTA: usa il database REALE (1200 righe), non la fixture T_TEST minimale
        (4 righe). Un cross join a 4 righe genera solo 4^n combinazioni: troppo
        poco lavoro perche' il progress_handler di SQLite abbia la certezza di
        scattare prima che la query finisca comunque da sola (dipende dai "passi"
        di virtual machine SQLite eseguiti, non dal tempo — su un runner CI
        veloce puo' completarsi prima del primo controllo). Con 1200 righe un
        cross join a 3 vie supera 1.7 miliardi di combinazioni: abbastanza
        pesante da garantire che il timeout scatti su qualunque ambiente.
        """
        real_db_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "database", "novabanca_core_banking.db"
        )
        if not os.path.exists(real_db_path):
            pytest.skip("Database reale non presente in questo ambiente di test")

        real_engine = DataAgentEngine(db_path=real_db_path)
        original_install = real_engine._install_query_timeout
        real_engine._install_query_timeout = lambda conn, max_seconds=0.05: original_install(conn, max_seconds)
        try:
            with pytest.raises(QueryTimeoutError):
                real_engine.execute_query(
                    "SELECT COUNT(*) FROM T_PRATICHE_FIDO a, T_PRATICHE_FIDO b, T_PRATICHE_FIDO c"
                )
        finally:
            real_engine._install_query_timeout = original_install
