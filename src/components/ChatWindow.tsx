import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { SearchingIndicator } from './SearchingIndicator';
import { ActionButton } from './ActionButtons';

import { WelcomeScreen } from './WelcomeScreen';
import { HelpScreen } from './HelpScreen';
import { useTheme } from '../contexts/ThemeContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useToast } from '../contexts/ToastContext';
import { api, SourcePage, EstimatePayload } from '../services/api';
import { ScrollArea } from './ui/scroll-area';

type Message = {
  id: string;
  type: 'bot' | 'user' | 'system' | 'form' | 'estimate';
  content: string;
  timestamp: Date;
  sourcePages?: SourcePage[];
  actions?: ActionButton[];
  isNew?: boolean; // For typewriter animation
};

type ChatStageType = 'welcome' | 'help' | 'chat';

export function ChatWindow() {
  const MESSAGES_STORAGE_KEY = 'chatWindow:messages:v1';
  const SESSION_STORAGE_KEY = 'chatWindow:sessionId:v1';

  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      if (typeof window === 'undefined') return [];
      const raw = localStorage.getItem(MESSAGES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Array<Omit<Message, 'timestamp'> & { timestamp: string }>;
      return parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp), isNew: false }));
    } catch {
      return [];
    }
  });

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [conversationStage, setConversationStage] = useState<ChatStageType>('welcome');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { colors } = useTheme();
  const { addNotification, playNotificationSound } = useNotifications();
  const { showError } = useToast();
  const prevMessagesLength = useRef(0);

  /* FIX: Persist sessionId for the entire conversation */
  const [sessionId, setSessionId] = useState(() => {
    try {
      if (typeof window === 'undefined') return 'session-' + Date.now();
      return localStorage.getItem(SESSION_STORAGE_KEY) || 'session-' + Date.now();
    } catch {
      return 'session-' + Date.now();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } catch { }
  }, [sessionId]);

  useEffect(() => {
    try {
      const serializable = messages.map((m) => ({ ...m, timestamp: m.timestamp.toISOString(), isNew: false }));
      localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(serializable));
    } catch { }
  }, [messages]);

  useEffect(() => {
    const handler = () => {
      try {
        localStorage.removeItem(MESSAGES_STORAGE_KEY);
        localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch { }

      setSessionId('session-' + Date.now());
      setMessages([]);
      setConversationStage('welcome');
    };

    window.addEventListener('chat:newConversation', handler as EventListener);
    return () => window.removeEventListener('chat:newConversation', handler as EventListener);
  }, []);

  useEffect(() => {
    const handler = async (event: Event) => {
      const sessionIdFromEvent = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (!sessionIdFromEvent) return;

      setConversationStage('chat');
      setIsSearching(true);
      setIsTyping(false);

      try {
        const history = await api.getConversationMessages(sessionIdFromEvent, { limit: 200 });
        setSessionId(sessionIdFromEvent);
        setMessages(history.map((m, index) => ({
          id: `${sessionIdFromEvent}-${index}-${m.createdAt}`,
          type: m.role === 'assistant' ? 'bot' : 'user',
          content: m.content,
          timestamp: new Date(m.createdAt),
          isNew: false,
        })));
      } catch (error) {
        console.error('Failed to load conversation messages', error);
        showError('Erreur de connexion, réessayez.');
      } finally {
        setIsSearching(false);
      }
    };

    window.addEventListener('chat:selectConversation', handler as EventListener);
    return () => window.removeEventListener('chat:selectConversation', handler as EventListener);
  }, [showError]);

  const processUserMessage = async (content: string, type: 'user' | 'system' = 'user') => {
    addMessage(content, type);
    setInput('');
    setIsSearching(true); // Start with searching state
    setIsTyping(false);

    const botMessageId = (Date.now() + 1).toString();
    let botMessageContent = '';
    let isFirstChunk = true;
    let messageSources: SourcePage[] | undefined;

    try {
      await api.sendMessageStream(
        {
          message: content,
          sessionId: sessionId,
          context: { stage: conversationStage }
        },
        (chunk: string) => {
          if (isFirstChunk) {
            setIsSearching(false);
            setIsTyping(false);
            isFirstChunk = false;

            // Play sound immediately when bot starts responding
            playNotificationSound();

            // Add the bot message on first chunk
            setMessages(prev => [...prev, {
              id: botMessageId,
              type: 'bot',
              content: chunk,
              timestamp: new Date(),
              sourcePages: messageSources
            }]);
            botMessageContent = chunk;
          } else {
            // Append to existing message
            botMessageContent += chunk;
            setMessages(prev => prev.map(msg =>
              msg.id === botMessageId
                ? { ...msg, content: botMessageContent }
                : msg
            ));
          }
        },
        // Metadata callback for RAG sources and actions
        (metadata) => {
          if (metadata.usedKnowledge) {
            console.log('🔍 Knowledge was used from:', metadata.sourcePages);
          }
          messageSources = metadata.sourcePages;
          const messageActions = metadata.suggestedActions;

          // Update the message with source pages and actions
          if (!isFirstChunk) {
            setMessages(prev => prev.map(msg =>
              msg.id === botMessageId
                ? {
                  ...msg,
                  sourcePages: messageSources || msg.sourcePages,
                  actions: messageActions // Update actions from backend
                }
                : msg
            ));

            // Smart Event Notification: If actions are present, trigger a visual popup
            if (messageActions && messageActions.length > 0) {
              addNotification({
                type: 'system',
                title: 'Actions disponibles',
                message: 'Le chatbot vous propose des actions interactives.',
              });
            }
          }
        }
      );

      // After stream complete
      if (isFirstChunk) {
        // If no chunks received
        setIsSearching(false);
        setIsTyping(false);
      }

    } catch (error) {
      console.error('API Error:', error);
      setIsSearching(false);
      setIsTyping(false);

      showError('Erreur de connexion. Veuillez vérifier votre connexion internet et réessayer.');

      playNotificationSound();

      setMessages(prev => [...prev, {
        id: (Date.now() + 2).toString(),
        type: 'bot',
        content: "Je suis désolé, une erreur de connexion s'est produite. Veuillez réessayer.",
        timestamp: new Date()
      }]);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, isSearching]);

  // Previous notification effect removed in favor of granular handling
  useEffect(() => {
    prevMessagesLength.current = messages.length;
  }, [messages]);

  const addMessage = (content: string, type: 'bot' | 'user' | 'system' | 'form' | 'estimate', actions?: ActionButton[]) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      type,
      content,
      timestamp: new Date(),
      actions,
      isNew: true
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  // Handle CTA button clicks
  const handleAction = useCallback((action: ActionButton) => {
    switch (action.type) {
      case 'schedule_visit':
        // Show embedded form instead of sending text
        addMessage('', 'form');
        break;
      case 'request_callback':
        processUserMessage("Je souhaite être rappelé");
        break;
      case 'request_estimate':
        // Ouvre le formulaire d'estimation INTÉGRÉ dans le chat (moteur réel)
        // au lieu d'envoyer un simple message texte.
        addMessage('', 'estimate');
        break;
      case 'view_properties':
        processUserMessage("Montrez-moi les biens disponibles");
        break;
      case 'contact_agent':
        processUserMessage("Je souhaite parler à un conseiller");
        break;
      default:
        console.log('Action clicked:', action);
    }
  }, []);

  const handleStartChat = () => {
    setConversationStage('chat');
    // Resume existing session if we have messages, otherwise start new
    if (messages.length === 0) {
      setSessionId('session-' + Date.now());
      const botMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: "👋 Bonjour ! Je suis ravi de vous accueillir. Comment puis-je vous aider aujourd'hui ?",
        timestamp: new Date(),
      };
      setMessages([botMessage]);
    }
  };

  const handleOpenHelp = () => {
    setConversationStage('help');
  };

  const handleBackToWelcome = () => {
    setConversationStage('welcome');
    // Do NOT clear messages or session ID to allow resuming
  };

  const handleFormSubmit = async (data: any) => {
    try {
      await api.submitLeadForm(sessionId, {
        prenom: data.prenom,
        nom: data.nom,
        telephone: data.telephone,
        email: data.email,
        projet: data.projet,
        details: data.details,
      });

      addMessage("Merci ! J'ai bien reçu vos informations. Un conseiller va vous rappeler très vite.", 'bot');
    } catch (e) {
      console.error("Failed to submit lead form", e);
      throw e;
    }
  };

  // Estimation intégrée au chat : appelle le moteur réel (DVF + DPE) et capture
  // le vendeur. Le résultat est affiché par EstimationForm lui-même.
  const handleEstimate = useCallback(
    (payload: Record<string, unknown>) =>
      api.estimate(payload as unknown as EstimatePayload),
    [],
  );

  const handleSend = () => {
    if (!input.trim()) return;
    processUserMessage(input);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Show welcome screen full screen
  if (conversationStage === 'welcome') {
    return <WelcomeScreen onStartChat={handleStartChat} onOpenHelp={handleOpenHelp} />;
  }

  // Show help screen full screen
  if (conversationStage === 'help') {
    return <HelpScreen onBack={handleBackToWelcome} />;
  }

  // Main chat interface (conversationStage === 'chat')
  return (
    <div
      data-testid="chat-window"
      className="h-full w-full bg-gradient-to-b from-blue-50/30 via-white to-white"
      style={{
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr) auto auto',
        overflow: 'hidden',
        maxWidth: '100%',
      }}
    >
      {/* Back Button */}
      <div className="px-4 py-3 bg-white/80 border-b border-gray-100">
        <button
          onClick={handleBackToWelcome}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-sm">Retour</span>
        </button>
      </div>

      {/* Messages Area - Strict width constraints */}
      <div
        data-testid="chat-messages"
        className="overflow-y-auto overflow-x-hidden overscroll-contain"
        style={{
          WebkitOverflowScrolling: 'touch',
          maxWidth: '100%',
          width: '100%',
        }}
      >
        <div
          className="px-3 py-4 space-y-3 sm:px-6 sm:py-5 sm:space-y-4"
          style={{ maxWidth: '100%', width: '100%' }}
        >
          {messages.map((message, index) => {
            const isLastBotMessage = message.type === 'bot' &&
              index === messages.map((m, i) => m.type === 'bot' ? i : -1).filter(i => i >= 0).pop();

            // Show CTA buttons on the last bot message
            const showActions = isLastBotMessage && !isSearching && !isTyping;
            const actionsToShow = showActions ? message.actions : undefined;

            return (
              <div key={message.id} className="animate-slide-up">
                <MessageBubble
                  type={message.type}
                  content={message.content}
                  timestamp={message.timestamp}
                  sourcePages={message.sourcePages}
                  actions={actionsToShow}
                  onAction={handleAction}
                  onFormSubmit={handleFormSubmit}
                  onEstimate={handleEstimate}
                  skipAnimation={!message.isNew}
                />
              </div>
            );
          })}

          {/* Searching Indicator - RAG lookup in progress */}
          {isSearching && (
            <div className="animate-fade-in">
              <SearchingIndicator />
            </div>
          )}

          {/* Typing Indicator - LLM generating response */}
          {isTyping && !isSearching && (
            <div className="animate-fade-in">
              <TypingIndicator />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Trust Badge */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
          <span>Données sécurisées • RGPD</span>
        </div>
      </div>

      {/* Input Bar - Clean white with subtle shadow */}
      <div className="flex-shrink-0 px-4 pb-4 bg-white safe-area-bottom">
        <div className="flex items-center gap-2 bg-white rounded-2xl px-3 py-2 shadow-sm border border-gray-100">
          <button className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors rounded-xl">
            <Paperclip className="w-5 h-5" />
          </button>

          <input
            data-testid="chat-input"
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Posez votre question…"
            className="flex-1 bg-transparent outline-none text-gray-800 placeholder-gray-400 text-[15px]"
          />

          <button
            data-testid="chat-send"
            onClick={handleSend}
            disabled={!input.trim() || isSearching || isTyping}
            className="w-9 h-9 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-all"
          >
            <Send className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
