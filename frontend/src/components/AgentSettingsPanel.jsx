import React, { useEffect, useState, useCallback } from 'react';
import {
  X, Cpu, Wrench, UserCog, FileUp, FileText, Trash2, Loader2,
  CheckCircle2, AlertCircle, Sparkles
} from 'lucide-react';
import { apiUrl } from '../config';

// Pannello di configurazione dell'agente: l'utente sceglie il modello LLM, quali
// tool abilitare per la sessione, il "tono" delle risposte (persona), e può
// caricare nuovi documenti nella Knowledge Base RAG senza toccare il backend.
export const AgentSettingsPanel = ({ agentConfig, onChangeConfig, onClose }) => {
  const [options, setOptions] = useState(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);

  const fetchOptions = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/agent-config/options'));
      const data = await res.json();
      setOptions(data);
    } catch (e) {
      console.warn('[AgentSettingsPanel] Impossibile caricare le opzioni:', e.message);
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/knowledge-base/documents'));
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (e) {
      console.warn('[AgentSettingsPanel] Impossibile caricare i documenti:', e.message);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    fetchOptions();
    fetchDocuments();
  }, [fetchOptions, fetchDocuments]);

  const toggleTool = (toolId) => {
    const isEnabled = agentConfig.enabledTools.includes(toolId);
    const nextTools = isEnabled
      ? agentConfig.enabledTools.filter((id) => id !== toolId)
      : [...agentConfig.enabledTools, toolId];
    onChangeConfig({ ...agentConfig, enabledTools: nextTools });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(apiUrl('/api/knowledge-base/upload'), {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Upload non riuscito.');
      }

      setUploadSuccess(`"${data.filename}" caricato e indicizzato correttamente.`);
      fetchDocuments();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      e.target.value = ''; // permette di ricaricare lo stesso file una seconda volta
    }
  };

  const handleDeleteDocument = async (filename) => {
    try {
      await fetch(apiUrl(`/api/knowledge-base/documents/${encodeURIComponent(filename)}`), {
        method: 'DELETE'
      });
      fetchDocuments();
    } catch (e) {
      console.warn('[AgentSettingsPanel] Errore rimozione documento:', e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-brand-bg/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-brand-surface border border-brand-surfaceAlt rounded-2xl max-w-xl w-full shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-brand-primary px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2 text-white">
            <UserCog className="w-5 h-5" />
            <h3 className="font-semibold text-sm">Impostazioni Agente</h3>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
          {loadingOptions ? (
            <div className="flex items-center justify-center py-8 text-brand-textMuted text-xs">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Caricamento opzioni...
            </div>
          ) : !options ? (
            <div className="text-xs text-rose-400 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4" />
              <span>Impossibile contattare il backend per le opzioni disponibili.</span>
            </div>
          ) : (
            <>
              {/* MODELLO LLM */}
              <section>
                <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-brand-textMuted uppercase tracking-wide mb-2">
                  <Cpu className="w-3.5 h-3.5 text-brand-primary" />
                  <span>Modello LLM</span>
                </div>
                <div className="space-y-1.5">
                  {options.models.map((m) => (
                    <label
                      key={m.id}
                      className={`flex items-center space-x-2 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                        agentConfig.model === m.id
                          ? 'border-brand-primary bg-brand-primary/10 text-brand-text'
                          : 'border-brand-surfaceAlt bg-brand-surfaceAlt/40 text-brand-textMuted hover:border-brand-border'
                      }`}
                    >
                      <input
                        type="radio"
                        name="model"
                        checked={agentConfig.model === m.id}
                        onChange={() => onChangeConfig({ ...agentConfig, model: m.id })}
                        className="accent-brand-primary"
                      />
                      <span>{m.label}</span>
                    </label>
                  ))}
                </div>
              </section>

              {/* TOOL ABILITATI */}
              <section>
                <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-brand-textMuted uppercase tracking-wide mb-2">
                  <Wrench className="w-3.5 h-3.5 text-brand-secondary" />
                  <span>Tool Abilitati per questa Sessione</span>
                </div>
                <div className="space-y-1.5">
                  {options.tools.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center space-x-2 p-2.5 rounded-lg border border-brand-surfaceAlt bg-brand-surfaceAlt/40 text-xs text-brand-textMuted cursor-pointer hover:border-brand-border transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={agentConfig.enabledTools.includes(t.id)}
                        onChange={() => toggleTool(t.id)}
                        className="accent-brand-secondary"
                      />
                      <span>{t.label}</span>
                    </label>
                  ))}
                </div>
                {agentConfig.enabledTools.length === 0 && (
                  <p className="text-[10px] text-amber-400 mt-1.5">
                    Nessun tool attivo: l'agente risponderà solo con conoscenza generale, senza consultare documenti o dati.
                  </p>
                )}
              </section>

              {/* PERSONA / TONO */}
              <section>
                <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-brand-textMuted uppercase tracking-wide mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-brand-primary" />
                  <span>Tono delle Risposte</span>
                </div>
                <div className="space-y-1.5">
                  {options.personas.map((p) => (
                    <label
                      key={p.id}
                      className={`flex items-center space-x-2 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                        agentConfig.persona === p.id
                          ? 'border-brand-primary bg-brand-primary/10 text-brand-text'
                          : 'border-brand-surfaceAlt bg-brand-surfaceAlt/40 text-brand-textMuted hover:border-brand-border'
                      }`}
                    >
                      <input
                        type="radio"
                        name="persona"
                        checked={agentConfig.persona === p.id}
                        onChange={() => onChangeConfig({ ...agentConfig, persona: p.id })}
                        className="accent-brand-primary"
                      />
                      <span>{p.label}</span>
                    </label>
                  ))}
                </div>
              </section>

              {/* KNOWLEDGE BASE */}
              <section>
                <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-brand-textMuted uppercase tracking-wide mb-2">
                  <FileText className="w-3.5 h-3.5 text-brand-secondary" />
                  <span>Documenti Knowledge Base (RAG)</span>
                </div>

                {loadingDocs ? (
                  <div className="text-[11px] text-brand-textMuted">Caricamento documenti...</div>
                ) : (
                  <div className="space-y-1.5 mb-3">
                    {documents.length === 0 && (
                      <div className="text-[11px] text-brand-textMuted italic">Nessun documento presente.</div>
                    )}
                    {documents.map((doc) => (
                      <div
                        key={doc.name}
                        className="flex items-center justify-between p-2 rounded-lg bg-brand-surfaceAlt/40 border border-brand-surfaceAlt text-[11px] text-brand-textMuted"
                      >
                        <span className="truncate mr-2">{doc.name} <span className="text-brand-textMuted">({doc.sizeKb} KB)</span></span>
                        <button
                          onClick={() => handleDeleteDocument(doc.name)}
                          title="Rimuovi documento"
                          className="text-brand-textMuted hover:text-rose-400 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <label className="flex items-center justify-center space-x-2 border border-dashed border-brand-border hover:border-brand-primary/60 rounded-lg p-3 cursor-pointer text-[11px] text-brand-textMuted hover:text-brand-primary transition-colors">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                  <span>{uploading ? 'Caricamento e indicizzazione in corso...' : 'Carica nuovo documento (.pdf, .txt, .md — max 5MB)'}</span>
                  <input
                    type="file"
                    accept=".pdf,.txt,.md"
                    onChange={handleFileChange}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>

                {uploadSuccess && (
                  <div className="flex items-center space-x-1.5 text-[11px] text-emerald-400 mt-2">
                    <CheckCircle2 className="w-3.5 h-3.5" /><span>{uploadSuccess}</span>
                  </div>
                )}
                {uploadError && (
                  <div className="flex items-center space-x-1.5 text-[11px] text-rose-400 mt-2">
                    <AlertCircle className="w-3.5 h-3.5" /><span>{uploadError}</span>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
