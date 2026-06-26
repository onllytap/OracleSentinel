import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2, Home, Building2, TrendingUp, X } from 'lucide-react';
import type { EstimateApiResult } from '../services/api';

// ============================================================================
// EstimationForm — formulaire d'estimation INTÉGRÉ DANS LE CHAT (bulle).
// Jumeau de LeadForm : même style/responsive. Branché sur le moteur réel
// (/api/estimate) via api.estimate(). Affiche la fourchette + le DPE et
// capture le vendeur (mandat) côté serveur. Pas de page séparée.
// ============================================================================

export type EstimationFormData = {
  surface: string;
  pieces?: string;
  address?: string;
  codePostal?: string;
  prenom: string;
  nom?: string;
  telephone?: string;
  email?: string;
};

interface EstimationFormProps {
  onEstimate: (payload: Record<string, unknown>) => Promise<EstimateApiResult>;
}

function euro(n?: number): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR').format(n) + ' €';
}

export function EstimationForm({ onEstimate }: EstimationFormProps) {
  const [typeLocal, setTypeLocal] = useState<'Maison' | 'Appartement'>('Maison');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [result, setResult] = useState<EstimateApiResult | null>(null);
  const [formError, setFormError] = useState('');

  const { register, handleSubmit, formState: { errors } } = useForm<EstimationFormData>({
    defaultValues: { surface: '', pieces: '', address: '', codePostal: '', prenom: '', nom: '', telephone: '', email: '' },
  });

  const onValid = async (data: EstimationFormData) => {
    setFormError('');
    if (!data.telephone && !data.email) {
      setFormError('Indiquez un téléphone ou un email pour recevoir l\'estimation.');
      return;
    }
    if (!data.address && !data.codePostal) {
      setFormError('Indiquez une adresse ou un code postal.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await onEstimate({
        typeLocal,
        surface: data.surface,
        pieces: data.pieces,
        address: data.address,
        codePostal: data.codePostal,
        prenom: data.prenom,
        nom: data.nom,
        telephone: data.telephone,
        email: data.email,
      });
      setResult(res);
    } catch {
      setFormError('Connexion impossible, réessayez.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Résultat ────────────────────────────────────────────────────────────
  if (result) {
    const est = result.estimate;
    const available = est?.available;
    return (
      <div className="bg-white/90 backdrop-blur-sm border border-emerald-100 rounded-2xl p-5 shadow-sm w-full max-w-sm animate-slide-up">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-emerald-600" aria-hidden="true" />
          </div>
          <h3 className="font-medium text-gray-900 text-sm">Votre estimation</h3>
        </div>

        {available ? (
          <div className="rounded-xl bg-emerald-50/70 border border-emerald-100 p-3 text-center">
            <div className="text-xs text-gray-500">Estimation indicative</div>
            <div className="text-2xl font-bold text-gray-900 my-1">{euro(est?.midPrice)}</div>
            <div className="text-xs text-gray-600">
              Fourchette : {euro(est?.lowPrice)} – {euro(est?.highPrice)}
              {est?.pricePerM2Median ? ` · ${est.pricePerM2Median} €/m²` : ''}
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm text-gray-600">
            Estimation à affiner pour ce secteur — un conseiller vous donnera une valeur précise.
          </div>
        )}

        {result.dpe?.message && (
          <div className={`mt-2 rounded-xl p-3 text-xs ${
            result.dpe.etiquette === 'F' || result.dpe.etiquette === 'G'
              ? 'bg-amber-50 border border-amber-200 text-amber-800'
              : 'bg-blue-50 border border-blue-100 text-blue-800'
          }`}>
            🔆 {result.dpe.message}
          </div>
        )}

        <div className="mt-3 rounded-xl bg-blue-600/[0.06] border border-blue-100 p-3 text-xs text-gray-700">
          ✅ Un conseiller local va vous recontacter pour affiner cette estimation.
        </div>

        {est?.disclaimer && (
          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">{est.disclaimer}</p>
        )}
      </div>
    );
  }

  // ── Formulaire replié ─────────────────────────────────────────────────────
  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm hover:bg-gray-50 transition-colors w-full sm:w-auto animate-fade-in"
      >
        <TrendingUp className="w-4 h-4 text-blue-600" aria-hidden="true" />
        <span className="text-sm font-medium text-gray-700">Reprendre mon estimation</span>
      </button>
    );
  }

  // ── Formulaire ──────────────────────────────────────────────────────────
  const inputCls = (err?: boolean) =>
    `w-full px-3 py-2 bg-white border ${err ? 'border-red-300' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-gray-400`;

  return (
    <div className="bg-white/80 backdrop-blur-sm border border-gray-100 rounded-2xl p-5 shadow-sm w-full max-w-sm animate-slide-up" role="dialog" aria-label="Estimer votre bien">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-blue-600" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900 text-sm">Estimez votre bien</h3>
            <p className="text-xs text-gray-500">Gratuit, en 1 minute. Données réelles + DPE.</p>
          </div>
        </div>
        <button onClick={() => setIsCollapsed(true)} className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600" type="button" aria-label="Masquer">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={handleSubmit(onValid)} className="space-y-3" noValidate>
        {/* Type de bien */}
        <div className="grid grid-cols-2 gap-2">
          {(['Maison', 'Appartement'] as const).map((t) => {
            const Icon = t === 'Maison' ? Home : Building2;
            const on = typeLocal === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTypeLocal(t)}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-sm transition-all ${
                  on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                <Icon className="w-4 h-4" /> {t}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <input
              {...register('surface', { required: true })}
              placeholder="Surface (m²)"
              type="number"
              inputMode="numeric"
              className={inputCls(!!errors.surface)}
            />
            {errors.surface && <span className="text-[10px] text-red-500 ml-1 block mt-0.5">Requis</span>}
          </div>
          <div>
            <input {...register('pieces')} placeholder="Pièces" type="number" inputMode="numeric" className={inputCls()} />
          </div>
        </div>

        <input {...register('address')} placeholder="Adresse du bien" className={inputCls()} />
        <input {...register('codePostal')} placeholder="Code postal (ex : 28000)" inputMode="numeric" className={inputCls()} />

        <div className="grid grid-cols-2 gap-3">
          <input {...register('prenom')} placeholder="Prénom" autoComplete="given-name" className={inputCls()} />
          <input {...register('nom')} placeholder="Nom" autoComplete="family-name" className={inputCls()} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input {...register('telephone')} placeholder="Téléphone" type="tel" autoComplete="tel" className={inputCls()} />
          <input {...register('email')} placeholder="Email" type="email" autoComplete="email" className={inputCls()} />
        </div>

        {formError && <p className="text-[11px] text-red-500">{formError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          style={{ backgroundColor: '#000000', color: '#ffffff' }}
          className="w-full font-medium py-2.5 rounded-xl text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-gray-200 hover:opacity-90"
          aria-busy={isSubmitting}
        >
          {isSubmitting ? (
            <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /><span>Estimation...</span></>
          ) : (
            'Estimer mon bien gratuitement'
          )}
        </button>
        <p className="text-[10px] text-center text-gray-400">Gratuit et sans engagement. Données confidentielles.</p>
      </form>
    </div>
  );
}
