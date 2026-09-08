import React, { useEffect, useState } from 'react';
import { Landmark, TrendingDown, Gauge, FileStack, Building2, AlertCircle } from 'lucide-react';
import { apiUrl } from '../config';

const ICONS = {
  'landmark': Landmark,
  'trending-down': TrendingDown,
  'gauge': Gauge,
  'file-stack': FileStack,
  'building': Building2
};

const COLORS = ['text-brand-primary', 'text-rose-400', 'text-brand-secondary', 'text-brand-primary', 'text-brand-secondary'];

// Formatta il valore del KPI in base all'unità restituita dal Data Agent Python
function formatKpiValue(kpi) {
  if (kpi.unit === 'EUR') {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0
    }).format(kpi.value);
  }
  if (kpi.unit === '%') {
    return `${kpi.value}%`;
  }
  if (kpi.unit === 'pt') {
    return `${kpi.value} pt`;
  }
  return kpi.value;
}

// Dashboard KPI executive sempre visibile sopra la chat: calcolata dal Data Agent
// Python interrogando l'intero portafoglio, indipendentemente dalla conversazione.
export const KpiCards = () => {
  const [kpis, setKpis] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchKpis = async () => {
      try {
        const res = await fetch(apiUrl('/api/kpis'));
        const data = await res.json();
        if (cancelled) return;

        if (data.kpis && data.kpis.length > 0) {
          setKpis(data.kpis);
          setError(false);
        } else {
          setError(true);
        }
      } catch (e) {
        console.warn('[KpiCards] Errore nel recupero KPI:', e.message);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchKpis();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 px-4 pt-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-brand-surface border border-brand-surfaceAlt rounded-xl p-3 h-[60px] animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || !kpis) {
    return (
      <div className="px-4 pt-4">
        <div className="flex items-center space-x-2 bg-brand-surface border border-brand-surfaceAlt rounded-xl px-3 py-2 text-[11px] text-brand-textMuted">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Dashboard KPI temporaneamente non disponibile (Data Agent non raggiungibile).</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 px-4 pt-4">
      {kpis.map((kpi, i) => {
        const Icon = ICONS[kpi.icon] || Gauge;
        const color = COLORS[i % COLORS.length];
        return (
          <div
            key={i}
            className="bg-brand-surface border border-brand-surfaceAlt rounded-xl p-3 flex flex-col justify-between shadow-sm"
          >
            <div className="flex items-center space-x-1.5 text-[10px] uppercase tracking-wide text-brand-textMuted">
              <Icon className={`w-3.5 h-3.5 ${color}`} />
              <span className="truncate">{kpi.label}</span>
            </div>
            <div className="text-sm font-bold text-brand-text mt-1">
              {formatKpiValue(kpi)}
            </div>
          </div>
        );
      })}
    </div>
  );
};
