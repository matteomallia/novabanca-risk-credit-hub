# Notebook di Prototipazione

Come suggerito dal brief di progetto, questi notebook documentano il lavoro di
prototipazione svolto **prima** di integrare la logica nell'architettura a
microservizi finale (`data_agent/`).

## `01_generazione_dataset_e_knowledge_base.ipynb`

Notebook (Google Colab) usato per **generare da zero** gli asset dati del
progetto:
- Il database SQLite `novabanca_core_banking.db` (4 tabelle relazionali, 1200
  record), con iniezione controllata di dati "sporchi" (~10-12%): redditi
  mancanti, età mancanti, spazi superflui nelle categorie professionali,
  outlier sul Credit Score fuori dal range 300-850.
- I documenti della Knowledge Base RAG (PDF generato via `fpdf2`, più i
  documenti di testo).

Il seed casuale è fissato (`np.random.seed(42)`) per la riproducibilità.

## `02_data_agent_prototyping.ipynb`

Notebook usato per **prototipare l'analisi** sul database già generato: pulizia
dati con Pandas, query SQL cross-tabella (incluso il JOIN corretto per il
calcolo del tasso di default, la cui scoperta ha portato a fissarlo come
esempio esplicito nel prompt dell'agente), generazione grafici con Seaborn e
sintesi narrativa — la stessa identica logica poi trasferita in
`data_agent/agent_engine.py`.

## Come eseguirli

Entrambi richiedono un ambiente Jupyter (locale, JupyterLab, o Google Colab
per il primo, che usa `google.colab.files` per il download diretto). Per
un'esecuzione locale:

```bash
cd data_agent
pip install -r requirements-dev.txt jupyter fpdf2
jupyter notebook ../notebooks/
```
