import React from 'react';

interface ProgressTrackerProps {
  currentStep: number;
  totalSteps: number;
}

export function ProgressTracker({ currentStep, totalSteps }: ProgressTrackerProps) {
  const progress = (currentStep / totalSteps) * 100;

  return (
    <div className="px-5 py-3 bg-white/90 backdrop-blur-sm border-b border-white/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-600">
          Étape {currentStep}/{totalSteps}
        </span>
        <span className="text-xs text-[#4A90FF]">
          {Math.round(progress)}%
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}