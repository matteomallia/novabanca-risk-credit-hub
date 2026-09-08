# Utilizziamo un'immagine base di Python 3.11 in versione Slim per ridurre le dimensioni
FROM python:3.11-slim

# Impostiamo le variabili d'ambiente per evitare file .pyc e bufferizzare i log di output
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Creiamo e impostiamo la directory di lavoro nel container
WORKDIR /app

# Installiamo dipendenze di sistema necessarie per la compilazione di Pandas/Matplotlib
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copiamo prima il file delle dipendenze per sfruttare il caching dei layer di Docker
COPY requirements.txt .

# Installiamo le librerie Python
RUN pip install --no-cache-dir -r requirements.txt

# Copiamo il codice sorgente del microservizio
COPY . .

# Creiamo la cartella dei grafici se non esiste
RUN mkdir -p /app/static/charts

# Esponiamo la porta 8000
EXPOSE 8000

# Comando di avvio del server ASGI Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]