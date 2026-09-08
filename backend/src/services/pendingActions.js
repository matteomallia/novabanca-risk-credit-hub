const crypto = require('crypto');

/**
 * Store in-memory delle azioni sensibili (es. invio email) generate dall'agente
 * ma NON ancora eseguite: implementano un pattern "human-in-the-loop" per cui
 * l'LLM può solo PREPARARE l'azione, mentre l'esecuzione reale avviene solo dopo
 * conferma esplicita dell'utente tramite l'interfaccia (endpoint /api/confirm-email).
 *
 * NOTA: essendo in-memory, questo store si azzera al riavvio del backend ed è
 * pensato per una singola istanza del processo Node.js (adeguato per un progetto
 * dimostrativo; in produzione andrebbe sostituito con Redis o un DB).
 */
const pendingEmails = new Map();

// Le richieste di conferma scadono dopo 15 minuti per evitare invii "fantasma" a distanza di ore
const EXPIRY_MS = 15 * 60 * 1000;

function createPendingEmail({ recipient, subject, content, chartPath }) {
    const id = crypto.randomUUID();
    pendingEmails.set(id, {
        recipient,
        subject,
        content,
        chartPath: chartPath || null,
        createdAt: Date.now()
    });
    return id;
}

function getPendingEmail(id) {
    const entry = pendingEmails.get(id);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > EXPIRY_MS) {
        pendingEmails.delete(id);
        return null;
    }
    return entry;
}

function resolvePendingEmail(id) {
    const entry = getPendingEmail(id);
    pendingEmails.delete(id);
    return entry;
}

module.exports = {
    createPendingEmail,
    getPendingEmail,
    resolvePendingEmail
};
