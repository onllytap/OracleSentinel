import React, { useState } from 'react';
import { Check, Mail, Phone, Building, Calendar, DollarSign, Target, Shield } from 'lucide-react';

interface LeadSummaryProps {
  data: any;
  onConfirm: () => void;
}

export function LeadSummary({ data, onConfirm }: LeadSummaryProps) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [consent, setConsent] = useState(false);
  const [showForm, setShowForm] = useState(true);

  const handleSubmit = () => {
    if (!email || !phone || !consent) return;
    setShowForm(false);
    setTimeout(() => {
      onConfirm();
    }, 500);
  };

  const getObjectiveLabel = (id: string) => {
    const labels: any = {
      leads: '🎯 Générer plus de leads',
      support: '💬 Automatiser support client',
      whatsapp: '📱 Automatiser WhatsApp/CRM',
      website: '🌐 Refaire site + conversion',
    };
    return labels[id] || id;
  };

  if (!showForm) {
    return (
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-2xl p-6 space-y-4 animate-slide-up">
        <div className="flex items-center justify-center">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
            <Check className="w-8 h-8 text-white" />
          </div>
        </div>
        <div className="text-center">
          <h3 className="text-green-800 mb-2">
            Demande envoyée avec succès !
          </h3>
          <p className="text-green-700 text-sm">
            Un expert vous contactera sous 24h pour discuter de votre projet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
      {/* Summary Header */}
      <div className="pb-3 border-b border-gray-100">
        <h3 className="text-gray-900 mb-1">
          📋 Récapitulatif de votre projet
        </h3>
        <p className="text-gray-600 text-sm">Vérifiez les informations avant de continuer</p>
      </div>

      {/* Project Details */}
      <div className="space-y-2.5">
        {data.objective && (
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
            <Target className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Objectif</p>
              <p className="text-slate-800">{getObjectiveLabel(data.objective)}</p>
            </div>
          </div>
        )}

        {data.sector && (
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
            <Building className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Secteur</p>
              <p className="text-slate-800">{data.sector}</p>
            </div>
          </div>
        )}

        {data.budget && (
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
            <DollarSign className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Budget</p>
              <p className="text-slate-800">{data.budget}</p>
            </div>
          </div>
        )}

        {data.delay && (
          <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
            <Calendar className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Délai</p>
              <p className="text-slate-800">{data.delay}</p>
            </div>
          </div>
        )}
      </div>

      {/* Contact Form */}
      <div className="pt-3 border-t border-gray-100 space-y-3">
        <p className="text-gray-800 text-[15px]">
          Dernière étape : vos coordonnées
        </p>

        <div className="space-y-2.5">
          <div className="relative">
            <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email professionnel"
              className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:border-blue-500 transition-colors text-[15px]"
            />
          </div>

          <div className="relative">
            <Phone className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Téléphone"
              className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:border-blue-500 transition-colors text-[15px]"
            />
          </div>

          <div className="relative">
            <Building className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Société (optionnel)"
              className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:border-blue-500 transition-colors text-[15px]"
            />
          </div>
        </div>

        {/* GDPR Consent */}
        <label className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl cursor-pointer hover:bg-blue-100/50 transition-colors">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-700 leading-relaxed">
            J'accepte d'être contacté par Cabinet IA. Mes données sont sécurisées et je peux les supprimer à tout moment.
          </span>
        </label>

        {/* Trust Elements */}
        <div className="flex items-center justify-center gap-4 text-xs text-gray-500 pt-1">
          <div className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            <span>RGPD</span>
          </div>
          <div className="flex items-center gap-1">
            <Check className="w-3 h-3" />
            <span>Sécurisé</span>
          </div>
          <div className="flex items-center gap-1">
            <Mail className="w-3 h-3" />
            <span>Aucun spam</span>
          </div>
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={!email || !phone || !consent}
          className="w-full py-3.5 bg-[#2B7EFF] hover:bg-blue-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl transition-all shadow-sm text-[15px]"
        >
          {consent ? '✨ Confirmer et envoyer' : '🔒 Veuillez accepter les conditions'}
        </button>
      </div>
    </div>
  );
}