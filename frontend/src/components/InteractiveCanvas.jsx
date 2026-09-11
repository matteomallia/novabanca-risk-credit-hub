import React, { useState } from 'react';
import { BarChart3, Maximize2, Download, FileDown, AlertCircle, Image as ImageIcon, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';

export const InteractiveCanvas = ({ chartUrl, summaryText }) => {
  const [imageError, setImageError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleDownloadPng = () => {
    if (!chartUrl) return;
    const link = document.createElement('a');
    link.href = chartUrl;
    link.download = `analisi_rischio_nvb_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Genera un report PDF one-pager con logo/intestazione NVB, il grafico e la
  // sintesi analitica testuale, pronto da archiviare o allegare manualmente.
  const handleExportPdf = async () => {
    if (!chartUrl || isExportingPdf) return;
    setIsExportingPdf(true);

    try {
      const response = await fetch(chartUrl);
      const blob = await response.blob();

      const base64data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 40;
      const contentWidth = pageWidth - margin * 2;

      // Intestazione aziendale
      doc.setFillColor('#005A9C');
      doc.rect(0, 0, pageWidth, 70, 'F');
      doc.setTextColor('#FFFFFF');
      doc.setFontSize(16);
      doc.setFont(undefined, 'bold');
      doc.text('NOVABANCA', margin, 32);
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text('Risk & Credit Intelligence Hub — Report Analitico', margin, 50);

      // Data di generazione
      doc.setTextColor('#666666');
      doc.setFontSize(9);
      doc.text(`Generato il ${new Date().toLocaleString('it-IT')}`, margin, 95);

      // Grafico
      const imgProps = doc.getImageProperties(base64data);
      const imgWidth = contentWidth;
      const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
      doc.addImage(base64data, 'PNG', margin, 110, imgWidth, imgHeight);

      // Sintesi analitica
      const textY = 110 + imgHeight + 30;
      doc.setTextColor('#005A9C');
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text('Sintesi Analitica', margin, textY);

      doc.setTextColor('#333333');
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      const splitSummary = doc.splitTextToSize(
        summaryText || 'Nessuna sintesi disponibile per questa analisi.',
        contentWidth
      );
      doc.text(splitSummary, margin, textY + 18);

      // Footer
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor('#999999');
      doc.text(
        'Documento generato automaticamente da un agente AI — uso interno NovaBanca.',
        margin,
        pageHeight - 20
      );

      doc.save(`Report_Analitico_ISP_${Date.now()}.pdf`);
    } catch (error) {
      console.error('[InteractiveCanvas] Errore durante l\'esportazione PDF:', error.message);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="bg-brand-surface border border-brand-surfaceAlt rounded-xl p-4 flex flex-col h-full shadow-lg relative">
      {/* Header Canvas */}
      <div className="flex items-center justify-between pb-3 border-b border-brand-surfaceAlt mb-3">
        <div className="flex items-center space-x-2">
          <BarChart3 className="w-5 h-5 text-brand-primary" />
          <h2 className="font-semibold text-sm text-brand-text tracking-wide uppercase">
            Interactive Canvas & Analytics
          </h2>
        </div>
        {chartUrl && (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1.5 hover:bg-brand-surfaceAlt text-brand-textMuted hover:text-brand-text rounded-lg transition-colors"
              title="Ingrandisci Grafico"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleDownloadPng}
              className="flex items-center space-x-1.5 bg-brand-surfaceAlt hover:bg-brand-border text-brand-text border border-brand-border px-3 py-1 rounded-lg text-xs font-medium transition-colors"
              title="Scarica il grafico come immagine PNG"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PNG</span>
            </button>
            <button
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className="flex items-center space-x-1.5 bg-brand-primary hover:bg-brand-primary disabled:opacity-60 text-white px-3 py-1 rounded-lg text-xs font-medium transition-colors shadow-sm"
              title="Esporta grafico + sintesi come report PDF"
            >
              {isExportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
              <span>Report PDF</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Display Area */}
      <div className="flex-1 flex flex-col items-center justify-center border border-brand-surfaceAlt/80 rounded-xl bg-brand-bg/60 p-4 relative overflow-hidden min-h-[300px]">
        {chartUrl && !imageError ? (
          <div className={`w-full h-full flex items-center justify-center ${isFullscreen ? 'fixed inset-0 z-50 bg-brand-bg/95 p-8' : ''}`}>
            <img
              src={chartUrl}
              alt="Grafico Analisi Rischio Credito NVB"
              onError={() => setImageError(true)}
              className="max-h-full max-w-full object-contain rounded-lg shadow-md border border-brand-surfaceAlt transition-all duration-300"
            />
            {isFullscreen && (
              <button
                onClick={() => setIsFullscreen(false)}
                className="absolute top-4 right-4 bg-brand-surfaceAlt hover:bg-brand-border text-brand-text px-4 py-2 rounded-lg text-xs font-medium"
              >
                Chiudi
              </button>
            )}
          </div>
        ) : imageError ? (
          <div className="flex flex-col items-center justify-center text-center p-6 space-y-2">
            <AlertCircle className="w-10 h-10 text-amber-500 animate-pulse" />
            <p className="text-xs text-brand-textMuted font-medium">Impossibile caricare il grafico generato.</p>
            <p className="text-[10px] text-brand-textMuted max-w-xs">
              Verifica che il percorso statico sia servito da Nginx su <code className="text-emerald-400">/static/charts/</code>.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="p-3 bg-brand-surface border border-brand-surfaceAlt rounded-full text-brand-textMuted">
              <ImageIcon className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-brand-textMuted">Nessun Grafico Attivo</p>
              <p className="text-[11px] text-brand-textMuted max-w-sm">
                Richiedi un'analisi quantitativa nella chat (es. <i>"Mostrami l'importo medio dei fidi per area geografica"</i>) per visualizzare il grafico qui.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Sintesi Analitica */}
      {summaryText && (
        <div className="mt-3 pt-3 border-t border-brand-surfaceAlt/80">
          <div className="text-[11px] text-brand-textMuted bg-brand-bg/40 p-2.5 rounded-lg border border-brand-surfaceAlt/50 leading-relaxed">
            <span className="font-semibold text-brand-secondary">Sintesi Analitica: </span>
            {summaryText}
          </div>
        </div>
      )}
    </div>
  );
};
