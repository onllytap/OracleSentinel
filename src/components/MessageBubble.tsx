import React, { Suspense, lazy } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useTheme } from '../contexts/ThemeContext';
import { useTypewriter, TypingCursor } from '../hooks/useTypewriter';
import { SourcePage } from '../services/api';
import { ActionButtons, ActionButton } from './ActionButtons';
import type { EstimateApiResult } from '../services/api';

const LazyLeadForm = lazy(() => import('./LeadForm').then(m => ({ default: m.LeadForm })));
const LazyEstimationForm = lazy(() => import('./EstimationForm').then(m => ({ default: m.EstimationForm })));

function FormLoadingFallback() {
  return (
    <div className="bg-white/80 backdrop-blur-sm border border-gray-100 rounded-2xl p-5 shadow-sm w-full max-w-sm">
      <div className="flex items-center justify-center gap-2 py-8">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        <span className="text-sm text-gray-500">Chargement du formulaire...</span>
      </div>
    </div>
  );
}

// ... (in types)
export interface MessageBubbleProps {
  type: 'bot' | 'user' | 'system' | 'form' | 'estimate';
  content?: string;
  timestamp: Date;
  sourcePages?: SourcePage[];
  actions?: ActionButton[];
  onAction?: (action: ActionButton) => void;
  onFormSubmit?: (data: any) => Promise<void>;
  onEstimate?: (payload: Record<string, unknown>) => Promise<EstimateApiResult>;
  skipAnimation?: boolean;
  isStreaming?: boolean;
}

// ... (in component)
export function MessageBubble({
  type,
  content = '',
  timestamp,
  sourcePages,
  actions,
  onAction,
  onFormSubmit, // New prop
  onEstimate,
  skipAnimation = false,
  isStreaming = false
}: MessageBubbleProps) {
  const { colors, avatar } = useTheme();

  // Form message
  if (type === 'form') {
    return (
      <div className="flex gap-2.5 items-start animate-slide-up">
        {/* Avatar (Same as bot) */}
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-green-400/50 shadow-md shadow-green-400/20">
            <ImageWithFallback
              src={avatar}
              alt="AI Assistant"
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Form Content */}
        <div className="max-w-[95%] sm:max-w-[90%] w-full">
          {onFormSubmit && (
            <Suspense fallback={<FormLoadingFallback />}>
              <LazyLeadForm onSubmit={onFormSubmit} />
            </Suspense>
          )}
        </div>
      </div>
    );
  }

  // Estimation form message (in-chat estimation, real engine behind it)
  if (type === 'estimate') {
    return (
      <div className="flex gap-2.5 items-start animate-slide-up">
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-green-400/50 shadow-md shadow-green-400/20">
            <ImageWithFallback
              src={avatar}
              alt="AI Assistant"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
        <div className="max-w-[95%] sm:max-w-[90%] w-full">
          {onEstimate && (
            <Suspense fallback={<FormLoadingFallback />}>
              <LazyEstimationForm onEstimate={onEstimate} />
            </Suspense>
          )}
        </div>
      </div>
    );
  }

  // ... (rest of render)

  // Typewriter effect for bot messages only
  const { displayedText, isTyping } = useTypewriter(content, {
    speed: 15,
    skip: type !== 'bot' || skipAnimation || isStreaming,
    startDelay: 100
  });

  // System messages
  if (type === 'system') {
    return (
      <div className="flex justify-center my-4">
        <div className="bg-green-50 text-green-700 px-4 py-2 rounded-full text-sm">
          {content}
        </div>
      </div>
    );
  }

  // User messages
  if (type === 'user') {
    return (
      <div className="flex justify-end items-start gap-2" style={{ maxWidth: '100%' }}>
        <div
          className="min-w-0"
          style={{ maxWidth: '90%' }}
        >
          <div
            className="text-white px-4 py-3 rounded-2xl rounded-tr-sm shadow-sm overflow-hidden"
            style={{
              background: `linear-gradient(to bottom right, ${colors.userBubbleFrom}, ${colors.userBubbleTo})`,
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              maxWidth: '100%',
            }}
          >
            <p className="text-[15px] leading-relaxed" style={{ wordBreak: 'break-all' }}>{content}</p>
          </div>
          <div className="text-xs text-gray-400 mt-1 text-right">
            {timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    );
  }

  // Bot message with typewriter effect
  const textToShow = skipAnimation || isStreaming ? content : displayedText;

  return (
    <div className="flex gap-2.5 items-start" style={{ maxWidth: '100%' }}>
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 rounded-full overflow-hidden border border-green-400/50 shadow-md shadow-green-400/20">
          <ImageWithFallback
            src={avatar}
            alt="AI Assistant"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-white"></div>
      </div>

      {/* Message Content */}
      <div className="min-w-0" style={{ maxWidth: 'calc(100% - 44px)' }}>
        <div
          className="px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm border border-gray-100/50 overflow-hidden"
          style={{
            background: `linear-gradient(to bottom right, ${colors.botBubbleFrom}, ${colors.botBubbleVia}, ${colors.botBubbleTo})`,
            wordBreak: 'break-all',
            overflowWrap: 'anywhere',
            maxWidth: '100%',
          }}
        >
          <p className="text-gray-800 text-[15px] leading-relaxed" style={{ wordBreak: 'break-all' }}>
            {textToShow}
            {isTyping && !skipAnimation && <TypingCursor visible={true} />}
          </p>
        </div>

        {/* Source Pages Badges */}
        {sourcePages && sourcePages.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {sourcePages.map((source, index) => (
              <a
                key={index}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs 
                           bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors
                           border border-blue-100"
              >
                <ExternalLink className="w-3 h-3" />
                <span className="max-w-[120px] truncate">{source.title}</span>
              </a>
            ))}
          </div>
        )}

        {/* CTA Action Buttons */}
        {actions && actions.length > 0 && onAction && (
          <ActionButtons
            actions={actions}
            onAction={onAction}
            disabled={isTyping && !skipAnimation}
          />
        )}

        {/* Timestamp */}
        <div className="text-xs text-gray-400 mt-1.5">
          {timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}