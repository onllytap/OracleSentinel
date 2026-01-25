import React, { useState } from 'react';
import { Calendar, Clock, Check } from 'lucide-react';

interface CalendarPickerProps {
  onSelect: (date: string, time: string) => void;
}

export function CalendarPicker({ onSelect }: CalendarPickerProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const dates = [
    { label: 'Lun 30 Déc', value: '2024-12-30' },
    { label: 'Mar 31 Déc', value: '2024-12-31' },
    { label: 'Mer 1 Jan', value: '2025-01-01' },
    { label: 'Jeu 2 Jan', value: '2025-01-02' },
  ];

  const times = [
    '09:00', '10:00', '11:00', '14:00', '15:00', '16:00',
  ];

  const handleConfirm = () => {
    if (selectedDate && selectedTime) {
      onSelect(selectedDate, selectedTime);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
        <Calendar className="w-5 h-5 text-blue-600" />
        <h4 className="text-gray-900">
          Réserver un appel
        </h4>
      </div>

      {/* Date Selection */}
      <div>
        <p className="text-gray-700 text-sm mb-2.5">Choisir une date</p>
        <div className="grid grid-cols-2 gap-2">
          {dates.map((date) => (
            <button
              key={date.value}
              onClick={() => setSelectedDate(date.value)}
              className={`p-3 rounded-xl border transition-all text-sm ${
                selectedDate === date.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-700 hover:border-blue-400'
              }`}
            >
              {date.label}
            </button>
          ))}
        </div>
      </div>

      {/* Time Selection */}
      {selectedDate && (
        <div className="animate-slide-up">
          <p className="text-gray-700 text-sm mb-2.5">Choisir un horaire</p>
          <div className="grid grid-cols-3 gap-2">
            {times.map((time) => (
              <button
                key={time}
                onClick={() => setSelectedTime(time)}
                className={`p-2.5 rounded-xl border transition-all text-sm ${
                  selectedTime === time
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-700 hover:border-blue-400'
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Confirm Button */}
      {selectedDate && selectedTime && (
        <button
          onClick={handleConfirm}
          className="w-full py-3.5 bg-[#2B7EFF] hover:bg-blue-600 text-white rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 animate-slide-up text-[15px]"
        >
          <Check className="w-5 h-5" />
          <span>Confirmer le rendez-vous</span>
        </button>
      )}

      {/* Info */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
        <Clock className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-800">
          Appel de 30 min avec un expert IA. Vous recevrez un email de confirmation.
        </p>
      </div>
    </div>
  );
}