import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { SearchingIndicator } from './SearchingIndicator';
import { ActionButton, getDefaultActions } from './ActionButtons';

import { WelcomeScreen } from './WelcomeScreen';
import { HelpScreen } from './HelpScreen';
import { useTheme } from '../contexts/ThemeContext';
import { useNotifications } from '../contexts/NotificationContext';
import { api, SourcePage } from '../services/api';

type Message = {
  id: string;
  type: 'bot' | 'user' | 'system' | 'form';
  content: string;
  timestamp: Date;
  sourcePages?: SourcePage[];
  actions?: ActionButton[];
  isNew?: boolean; // For typewriter animation
};

type ChatStageType = 'welcome' | 'help' | 'chat';

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [conversationStage, setConversationStage] = useState<ChatStageType>('welcome');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { colors } = useTheme();
  const { addNotification } = useNotifications();
  const prevMessagesLength = useRef(0);

  /* FIX: Persist sessionId for the entire conversation */
  const [sessionId, setSessionId] = useState(() => 'session-' + Date.now());

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

      // Show error message to user
      setMessages(prev => [...prev, {
        id: (Date.now() + 2).toString(),
        type: 'bot',
        content: "Je suis désolé, une erreur de connexion s'est produite. Veuillez vérifier votre connexion internet et réessayer.",
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

  // Detect new bot messages and create notifications
  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      const newMessages = messages.slice(prevMessagesLength.current);
      newMessages.forEach((message) => {
        if (message.type === 'bot') {
          addNotification({
            type: 'message',
            title: 'Nouveau message',
            message: message.content.substring(0, 100) + (message.content.length > 100 ? '...' : ''),
          });
        }
      });
    }
    prevMessagesLength.current = messages.length;
  }, [messages, addNotification]);

  const addMessage = (content: string, type: 'bot' | 'user' | 'system' | 'form', actions?: ActionButton[]) => {
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
        processUserMessage("Je souhaite une estimation gratuite de mon bien");
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
    // 1. Show user it's done
    addMessage("Merci ! J'ai bien reçu vos informations. Un conseiller va vous rappeler très vite.", 'bot');

    // 2. Synthesize a message for the bot context (hidden if possible, here just text)
    const summary = `[FORMULAIRE REÇU]
    Nom: ${data.prenom} ${data.nom}
    Tel: ${data.telephone}
    Projet: ${data.projet}`;

    // 3. Send to backend to trigger CRM/Lead logic
    try {
      await api.sendMessageStream({
        message: summary,
        sessionId: sessionId,
        context: { stage: conversationStage }
      }, () => { }, () => { });
    } catch (e) {
      console.error("Failed to sync form data", e);
    }
  };

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
    return <HelpScreen />;
  }

  // Main chat interface (conversationStage === 'chat')
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex-1 flex flex-col h-full min-h-0 bg-gradient-to-b from-blue-50/30 via-white to-white">
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



        {/* Messages Area - Gradient background for smooth transition */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 sm:px-6 sm:py-5 sm:space-y-4 pb-32">
          {messages.map((message, index) => {
            const isLastBotMessage = message.type === 'bot' &&
              index === messages.map((m, i) => m.type === 'bot' ? i : -1).filter(i => i >= 0).pop();

            // Show CTA buttons on the last bot message
            const showActions = isLastBotMessage && !isSearching && !isTyping;
            const actionsToShow = showActions ? (message.actions || getDefaultActions('property')) : undefined;

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

        {/* Trust Badge */}
        <div className="px-4 py-3 border-t border-gray-100 bg-white/80 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <span>Données sécurisées • RGPD</span>
          </div>
        </div>

        {/* Input Bar - Clean white with subtle shadow */}
        <div className="px-4 pb-4 bg-white">
          <div className="flex items-center gap-2 bg-white rounded-2xl px-3 py-2 shadow-sm border border-gray-100">
            <button className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors rounded-xl">
              <Paperclip className="w-5 h-5" />
            </button>

            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Posez votre question…"
              className="flex-1 bg-transparent outline-none text-gray-800 placeholder-gray-400 text-[15px]"
            />

            <button
              onClick={handleSend}
              disabled={!input.trim() || isSearching || isTyping}
              className="w-9 h-9 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-all"
            >
              <Send className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}