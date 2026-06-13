import React, { useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';

interface LeadQualificationProps {
  onStepComplete: (step: number, data: any) => void;
  onComplete: (data: any) => void;
}

const objectives = [
  { id: 'leads', label: '🎯 Générer plus de leads', icon: '🎯' },
  { id: 'support', label: '💬 Automatiser support client', icon: '💬' },
  { id: 'whatsapp', label: '📱 Automatiser WhatsApp/CRM', icon: '📱' },
  { id: 'website', label: '🌐 Refaire site + conversion', icon: '🌐' },
];

const sectors = [
  'E-commerce', 'Services B2B', 'Santé', 'Immobilier', 'Finance', 'Technologie', 'Autre',
];

const volumes = [
  '< 50 / semaine',
  '50-200 / semaine',
  '200-500 / semaine',
  '> 500 / semaine',
];

const budgets = [
  '< 5 000€',
  '5 000€ - 15 000€',
  '15 000€ - 50 000€',
  '> 50 000€',
];

const delays = [
  'Urgent (< 1 mois)',
  'Court terme (1-3 mois)',
  'Moyen terme (3-6 mois)',
  'Long terme (> 6 mois)',
];

export function LeadQualification({ onStepComplete, onComplete }: LeadQualificationProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [formData, setFormData] = useState<any>({});
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const questions = [
    {
      question: "Quel est votre objectif principal ?",
      options: objectives,
      field: 'objective',
      type: 'cards',
    },
    {
      question: "Quel est votre secteur d'activité ?",
      options: sectors,
      field: 'sector',
      type: 'buttons',
    },
    {
      question: "Quel volume de demandes recevez-vous par semaine ?",
      options: volumes,
      field: 'volume',
      type: 'buttons',
    },
    {
      question: "Quel est votre budget estimé ?",
      options: budgets,
      field: 'budget',
      type: 'buttons',
    },
    {
      question: "Quel est votre délai souhaité ?",
      options: delays,
      field: 'delay',
      type: 'buttons',
    },
  ];

  const currentQ = questions[currentQuestion];

  const handleSelect = (value: string) => {
    const newData = { ...formData, [currentQ.field]: value };
    setFormData(newData);
    setSelectedOption(value);

    // Wait a bit for visual feedback
    setTimeout(() => {
      onStepComplete(currentQuestion, newData);
      
      if (currentQuestion < questions.length - 1) {
        setCurrentQuestion(currentQuestion + 1);
        setSelectedOption(null);
      } else {
        // Move to contact info
        setTimeout(() => {
          onComplete(newData);
        }, 500);
      }
    }, 300);
  };

  if (currentQ.type === 'cards') {
    return (
      <div className="space-y-3">
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 shadow-sm">
          <p className="text-gray-800 text-[15px] leading-relaxed">{currentQ.question}</p>
        </div>
        <div className="grid grid-cols-1 gap-2.5">
          {currentQ.options.map((option: any) => (
            <button
              key={option.id}
              onClick={() => handleSelect(option.id)}
              className={`p-4 bg-white rounded-xl text-left transition-all hover:shadow-md shadow-sm ${
                selectedOption === option.id
                  ? 'ring-2 ring-[#4A90FF]'
                  : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-gray-800 text-[15px]">{option.label}</span>
                {selectedOption === option.id && (
                  <Check className="w-5 h-5 text-[#4A90FF]" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 shadow-sm">
        <p className="text-gray-800 text-[15px] leading-relaxed">{currentQ.question}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(currentQ.options as string[]).map((option: string) => (
          <button
            key={option}
            onClick={() => handleSelect(option)}
            className={`px-4 py-2.5 bg-white rounded-xl transition-all text-sm shadow-sm ${
              selectedOption === option
                ? 'bg-[#4A90FF] text-white'
                : 'text-gray-700 hover:shadow-md'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
