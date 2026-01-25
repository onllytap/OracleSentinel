import React from 'react';
import { Check, Sparkles, Rocket, Crown } from 'lucide-react';

interface OfferCardsProps {
  onSelect: (offer: string) => void;
}

const offers = [
  {
    id: 'starter',
    name: 'Starter',
    icon: Sparkles,
    price: '5 000€',
    description: 'Idéal pour tester l\'IA',
    features: [
      'Chatbot personnalisé',
      'Qualification de leads',
      'Support 30 jours',
    ],
    color: 'from-slate-500 to-slate-600',
  },
  {
    id: 'growth',
    name: 'Growth',
    icon: Rocket,
    price: '15 000€',
    description: 'Pour scaler votre business',
    features: [
      'Tout Starter +',
      'Intégration CRM/WhatsApp',
      'Dashboard analytics',
    ],
    color: 'from-blue-500 to-blue-600',
    popular: true,
  },
  {
    id: 'premium',
    name: 'Premium',
    icon: Crown,
    price: 'Sur mesure',
    description: 'Solution enterprise',
    features: [
      'Tout Growth +',
      'Multi-agents IA',
      'Support prioritaire 24/7',
    ],
    color: 'from-purple-500 to-purple-600',
  },
];

export function OfferCards({ onSelect }: OfferCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {offers.map((offer) => {
        const Icon = offer.icon;
        return (
          <button
            key={offer.id}
            onClick={() => onSelect(offer.name)}
            className="relative group text-left"
          >
            <div className={`
              relative p-4 rounded-2xl bg-white border border-gray-100 transition-all duration-300 overflow-hidden
              shadow-md hover:shadow-lg
              hover:scale-[1.02] hover:-translate-y-1
              ${offer.popular ? 'ring-2 ring-blue-400' : ''}
            `}>
              {/* Gradient overlay on hover */}
              <div className={`
                absolute inset-0 bg-gradient-to-br ${offer.color} opacity-0 
                group-hover:opacity-5 transition-opacity duration-300
              `}></div>

              {offer.popular && (
                <div className="absolute -top-1 -right-1">
                  <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white text-[10px] px-2.5 py-1 rounded-full shadow-lg">
                    ⭐ Populaire
                  </div>
                </div>
              )}

              <div className="relative z-10">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${offer.color} flex items-center justify-center mb-3 shadow-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>

                <h3 className="text-gray-900 mb-1">{offer.name}</h3>
                <div className="mb-2">
                  <span className="text-gray-900 text-xl">{offer.price}</span>
                </div>
                <p className="text-sm text-gray-600 mb-3">{offer.description}</p>

                <ul className="space-y-1.5">
                  {offer.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2 text-xs text-gray-700">
                      <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* Hover indicator */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-500 group-hover:text-blue-600 transition-colors">
                    Sélectionner →
                  </span>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}