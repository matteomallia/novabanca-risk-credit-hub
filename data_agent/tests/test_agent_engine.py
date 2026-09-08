"""
Test automatici per DataAgentEngine e il validatore di sicurezza SQL.

Esecuzione: pytest data_agent/tests/ -v
(dalla cartella data_agent/, con le dipendenze di requirements.txt installate)
"""
import os
import sys
import sqlite3
import tempfile

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent_engine import DataAgentEngine, UnsafeQueryError, validate_readonly_select  # noqa: E402


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
        query = validate_readonly_select("SELECT * FROM T_TEST")
        assert query == "SELECT * FROM T_TEST"

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
        raw = pd.DataFrame({"Credit_Score_ISP": [650, 999, 100, 720]})
        cleaned = engine.clean_dataset(raw)
        assert cleaned["Credit_Score_ISP"].between(300, 850).all()

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
