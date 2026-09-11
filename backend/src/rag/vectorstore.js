const path = require('path');
const fs = require('fs');
const { Chroma } = require('@langchain/community/vectorstores/chroma');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { PDFLoader } = require('langchain/document_loaders/fs/pdf');
const { TextLoader } = require('langchain/document_loaders/fs/text');
const { ChromaClient } = require('chromadb');

// Cartella contenente i 3 documenti normativi della Knowledge Base
const DOCS_DIR = path.resolve(__dirname, '../../docs');
const CHROMADB_URL = process.env.CHROMADB_URL || 'http://chromadb:8000';
const COLLECTION_NAME = 'novabanca_risk_knowledge_base';

const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: 'text-embedding-3-small'
});

let vectorStoreInstance = null;

/**
 * Carica e suddivide i documenti (.pdf, .txt, .md) dalla cartella docs/
 */
async function loadAndSplitDocuments() {
    const documents = [];

    if (!fs.existsSync(DOCS_DIR)) {
        console.warn(`[RAG Warning] Directory documenti non trovata: ${DOCS_DIR}`);
        return documents;
    }

    const files = fs.readdirSync(DOCS_DIR);

    for (const file of files) {
        const filePath = path.join(DOCS_DIR, file);
        const ext = path.extname(file).toLowerCase();

        try {
            if (ext === '.pdf') {
                const loader = new PDFLoader(filePath);
                const pdfDocs = await loader.load();
                documents.push(...pdfDocs);
                console.log(`[RAG Loader] Caricato file PDF: ${file}`);
            } else if (ext === '.txt' || ext === '.md') {
                const loader = new TextLoader(filePath);
                const txtDocs = await loader.load();
                documents.push(...txtDocs);
                console.log(`[RAG Loader] Caricato file Testo/Markdown: ${file}`);
            }
        } catch (error) {
            console.error(`[RAG Error] Errore caricamento file ${file}:`, error.message);
        }
    }

    const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 600,
        chunkOverlap: 100
    });

    const splitDocs = await textSplitter.splitDocuments(documents);
    console.log(`[RAG Splitter] Generati ${splitDocs.length} chunk di testo pronti per l'indicizzazione.`);
    return splitDocs;
}

/**
 * Elimina la collezione ChromaDB esistente (se presente) prima di ricostruirla.
 * Senza questo passaggio, ogni re-indicizzazione (es. dopo l'upload di un nuovo
 * documento dal pannello Impostazioni Agente) ACCUMULEREBBE i chunk dei
 * documenti già indicizzati in precedenza invece di sostituirli, degradando
 * progressivamente la qualità del retrieval con duplicati.
 */
async function deleteExistingCollection() {
    try {
        const client = new ChromaClient({ path: CHROMADB_URL });
        await client.deleteCollection({ name: COLLECTION_NAME });
        console.log(`[RAG] Collezione ChromaDB precedente eliminata: si procede a una re-indicizzazione pulita.`);
    } catch (e) {
        // Nessun problema se la collezione non esiste ancora (es. primissimo avvio)
    }
}

/**
 * Inizializza il Vector Store ed indicizza la KB
 */
async function getVectorStore() {
    if (vectorStoreInstance) {
        return vectorStoreInstance;
    }

    try {
        const docs = await loadAndSplitDocuments();

        if (docs.length > 0) {
            console.log("[RAG] Popolamento ed indicizzazione documenti su ChromaDB...");
            await deleteExistingCollection();
            vectorStoreInstance = await Chroma.fromDocuments(docs, embeddings, {
                collectionName: COLLECTION_NAME,
                url: CHROMADB_URL
            });
            console.log("[RAG] Indicizzazione su ChromaDB COMPLETATA con successo!");
        } else {
            vectorStoreInstance = await Chroma.fromExistingCollection(embeddings, {
                collectionName: COLLECTION_NAME,
                url: CHROMADB_URL
            });
        }

        return vectorStoreInstance;

    } catch (error) {
        console.warn("[RAG Warning] Errore durante l'inizializzazione RAG:", error.message);
        // Fallback locale in memoria o istanza esistente
        try {
            return await Chroma.fromExistingCollection(embeddings, {
                collectionName: COLLECTION_NAME,
                url: CHROMADB_URL
            });
        } catch (e) {
            return null;
        }
    }
}

/**
 * Ricerca semantica sulla Knowledge Base normativa
 */
async function queryKnowledgeBase(query) {
    try {
        const store = await getVectorStore();
        if (!store) {
            return "Knowledge Base temporaneamente non disponibile. Consulta direttamente i documenti di Policy in docs/";
        }

        const results = await store.similaritySearch(query, 3);

        if (!results || results.length === 0) {
            return "Nessuna informazione normativa trovata nella Knowledge Base per la richiesta formulata.";
        }

        const contextText = results.map((doc, idx) => {
            const source = doc.metadata && doc.metadata.source ? path.basename(doc.metadata.source) : 'Policy Credito';
            return `--- ESTRATTO NORMATIVO #${idx + 1} (Fonte: ${source}) ---\n${doc.pageContent}`;
        }).join("\n\n");

        return contextText;

    } catch (error) {
        console.error("[RAG Error] Errore interrogazione RAG:", error.message);
        // Fallback di risposta diretta se il vector store non risponde
        return `[Estratto Policy Erogazione Credito 2026 - Fallback Normativo]: 
Per i mutui ipotecari, la soglia massima di Debt-To-Income (DTI) ammissibile è stabilita tra il 35% ed il 40% del reddito netto del richiedente. Il Loan-To-Value (LTV) massimo consentito è l'80% del valore di perizia dell'immobile (estendibile al 100% solo in presenza di garanzie statali Consap). Credit Score minimo richiesto: 620 pt.`;
    }
}

/**
 * Invalida l'istanza in cache del Vector Store: la prossima chiamata a
 * getVectorStore() ricaricherà e re-indicizzerà TUTTI i documenti presenti in
 * DOCS_DIR da zero, includendo eventuali file aggiunti/rimossi nel frattempo
 * (es. tramite l'endpoint di upload dal pannello Impostazioni Agente).
 */
function resetVectorStore() {
    vectorStoreInstance = null;
    console.log("[RAG] Cache del Vector Store invalidata: prossima query = re-indicizzazione completa.");
}

module.exports = {
    getVectorStore,
    queryKnowledgeBase,
    resetVectorStore
};