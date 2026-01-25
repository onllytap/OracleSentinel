import React from 'react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useTheme } from '../contexts/ThemeContext';

export function TypingIndicator() {
  const { colors } = useTheme();
  
  return (
    <div className="flex gap-3 items-start">
      <div className="relative flex-shrink-0">
        <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-green-400 shadow-lg shadow-green-400/30">
          <ImageWithFallback
            src="https://images.unsplash.com/photo-1763788427834-95dec952e9cd?w=100&h=100&fit=crop"
            alt="AI Assistant"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border border-white shadow-sm shadow-green-400/50 animate-pulse"></div>
      </div>
      <div 
        className="px-5 py-3 rounded-3xl rounded-tl-md shadow-md"
        style={{
          background: `linear-gradient(to bottom right, ${colors.botBubbleFrom}, ${colors.botBubbleVia}, ${colors.botBubbleTo})`
        }}
      >
        <div className="flex gap-1.5">
          <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
          <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
          <div className="w-2 h-2 bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
        </div>
      </div>
    </div>
  );
}