# -----------------------------------------------------------------------------
# STAGE 1: BUILD REACT APP WITH VITE
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Copia dei manifest e installazione dipendenze
COPY package*.json ./
# Modifica la riga 10:
RUN npm install

# Copia del codice sorgente e compilazione dei file statici
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# STAGE 2: PRODUCTION SERVER WITH NGINX
# -----------------------------------------------------------------------------
FROM nginx:alpine

# Rimuovi la configurazione di default di Nginx
RUN rm -rf /etc/nginx/conf.d/default.conf

# Copia la nostra configurazione personalizzata di Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia gli asset statici compilati dallo Stage 1
COPY --from=build /app/dist /usr/share/nginx/html

# Esponi la porta 80
EXPOSE 80

# Avvia Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]