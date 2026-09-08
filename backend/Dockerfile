# Utilizziamo l'immagine ufficiale Node.js 20 basata su Alpine Linux per la massima leggerezza
FROM node:20-alpine

# Impostiamo la directory di lavoro all'interno del container
WORKDIR /app

# Copiamo prima i manifest delle dipendenze per sfruttare il caching dei layer di Docker
COPY package*.json ./

# Installiamo le dipendenze npm per la produzione
RUN npm install --only=production

# Copiamo tutto il codice sorgente del microservizio backend
COPY . .

# Creiamo la cartella docs per la Knowledge Base RAG se non esiste
RUN mkdir -p /app/docs

# Esponiamo la porta 5000 su cui ascolta il server Express
EXPOSE 5000

# Definiamo la variabile d'ambiente di default per la produzione
ENV NODE_ENV=production

# Comando di avvio dell'Orchestratore Node.js
CMD ["node", "src/index.js"]