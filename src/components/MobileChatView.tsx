import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Menu, ArrowLeft } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { WelcomeScreen } from './WelcomeScreen';
import { MessagesWelcomeScreen } from './MessagesWelcomeScreen';
import { HelpScreen } from './HelpScreen';
import { ContactScreen } from './ContactScreen';
import { BottomNavBar } from './BottomNavBar';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../services/api';

type Message = {
  id: string;
  type: 'bot' | 'user' | 'system';
  content: string;
  timestamp: Date;
};

type MobileChatStage = 'welcome' | 'help' | 'chat';

export function MobileChatView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [conversationStage, setConversationStage] = useState<MobileChatStage>('welcome');
  const [currentView, setCurrentView] = useState<'home' | 'messages' | 'help' | 'contact'>('home');
  const [isChatStarted, setIsChatStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { colors } = useTheme();

  const processUserMessage = async (content: string, type: 'user' | 'system' = 'user') => {
    addMessage(content, type);
    setInput('');
    setIsTyping(true);

    const botMessageId = (Date.now() + 1).toString();
    let botMessageContent = '';
    let isFirstChunk = true;

    try {
      await api.sendMessageStream(
        {
          message: content,
          sessionId: 'session-' + Date.now(), // Simple session ID for now
          context: { stage: conversationStage, view: currentView }
        },
        (chunk: string) => {
          if (isFirstChunk) {
            setIsTyping(false);
            isFirstChunk = false;
            // Add the bot message on first chunk
            setMessages((prev) => [...prev, {
              id: botMessageId,
              type: 'bot',
              content: chunk,
              timestamp: new Date()
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
        }
      );

      // After stream complete
      if (isFirstChunk) {
        // If no chunks received
        setIsTyping(false);
      }

    } catch (error) {
      console.error('API Error:', error);
      setIsTyping(false);
      // addMessage("Désolé, une erreur est survenue.", 'system'); 
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleStartChat = () => {
    setConversationStage('chat');
    const botMessage: Message = {
      id: Date.now().toString(),
      type: 'bot',
      content: "👋 Bonjour ! Je suis ravi de vous accueillir. Comment puis-je vous aider aujourd'hui ?",
      timestamp: new Date(),
    };
    setMessages([botMessage]);
    setIsTyping(false);
    setIsChatStarted(true);
  };

  const handleOpenHelp = () => {
    setConversationStage('help');
    setCurrentView('help');
  };

  const handleBackToWelcome = () => {
    setConversationStage('welcome');
    setMessages([]);
    setCurrentView('home');
    setIsChatStarted(false);
  };

  const handleNavigate = (view: 'home' | 'messages' | 'help' | 'contact') => {
    setCurrentView(view);

    // Ne pas démarrer automatiquement le chat
    if (view === 'home' || view === 'messages') {
      if (!isChatStarted) {
        setConversationStage('welcome');
      }
    } else if (view === 'help') {
      // Stay on help view
    } else if (view === 'contact') {
      // Stay on contact view
    }
  };

  const addMessage = (content: string, type: 'bot' | 'user' | 'system') => {
    const newMessage: Message = {
      id: Date.now().toString(),
      type,
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  const handleSend = () => {
    if (!input.trim()) return;
    processUserMessage(input);
  };



  // Show welcome screen
  if (currentView === 'home' || (currentView === 'messages' && !isChatStarted)) {
    return (
      <div className="h-screen flex flex-col">
        {currentView === 'home' ? (
          <WelcomeScreen onStartChat={() => {
            handleStartChat();
            setCurrentView('messages');
          }} onOpenHelp={() => {
            handleOpenHelp();
            setCurrentView('help');
          }} />
        ) : (
          <MessagesWelcomeScreen onStartChat={() => {
            handleStartChat();
            setCurrentView('messages');
          }} onOpenHelp={() => {
            handleOpenHelp();
            setCurrentView('help');
          }} />
        )}
        <BottomNavBar currentView={currentView} onNavigate={handleNavigate} />
      </div>
    );
  }

  // Show help screen
  if (currentView === 'help') {
    return (
      <div className="h-screen flex flex-col">
        <HelpScreen onBack={() => setCurrentView('home')} />
        <BottomNavBar currentView={currentView} onNavigate={handleNavigate} />
      </div>
    );
  }

  // Show contact screen
  if (currentView === 'contact') {
    return (
      <div className="h-screen flex flex-col">
        <ContactScreen onBack={() => setCurrentView('home')} />
        <BottomNavBar currentView={currentView} onNavigate={handleNavigate} />
      </div>
    );
  }

  // Show messages/chat screen
  return (
    <div className="h-screen flex flex-col">
      <div
        className="flex-1 flex flex-col max-w-md mx-auto w-full"
        style={{
          background: `linear-gradient(to bottom, ${colors.backgroundFrom}, ${colors.backgroundVia}, ${colors.backgroundTo})`
        }}
      >
        {/* Mobile Header with gradient blend */}
        <div
          className="relative px-4 pt-12 pb-4 safe-area-top"
          style={{
            background: `linear-gradient(to bottom, ${colors.headerFrom}, ${colors.headerVia}, transparent)`
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Back Button */}
              <button
                onClick={handleBackToWelcome}
                className="w-9 h-9 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors border border-white/30"
              >
                <ArrowLeft className="w-4 h-4 text-white" />
              </button>

              <div className="relative">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-green-400 shadow-lg shadow-green-400/50">
                  <ImageWithFallback
                    src="https://images.unsplash.com/photo-1763788427834-95dec952e9cd?w=100&h=100&fit=crop"
                    alt="AI Assistant"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-white shadow-lg shadow-green-400/50 animate-pulse"></div>
              </div>
              <div>
                <h2 className="text-white text-base drop-shadow-sm">
                  Cabinet IA
                </h2>
                <p className="text-white/80 text-xs">Online</p>
              </div>
            </div>

            <button className="w-10 h-10 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-full flex items-center justify-center transition-colors border border-white/30">
              <Menu className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>



        {/* Messages Area - Transparent to show gradient */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((message) => (
            <div key={message.id} className="animate-slide-up">
              <MessageBubble
                type={message.type}
                content={message.content}
                timestamp={message.timestamp}
              />
            </div>
          ))}

          {isTyping && (
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
            <span>Sécurisé • RGPD</span>
          </div>
        </div>

        {/* Input Bar */}
        <div className="px-4 pb-6 pt-3 bg-white safe-area-bottom">
          <div className="flex items-center gap-2 bg-white rounded-2xl px-3 py-2 shadow-sm border border-gray-100">
            <button className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors rounded-xl">
              <Paperclip className="w-5 h-5" />
            </button>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleSend();
                }
              }}
              placeholder="Votre message..."
              className="flex-1 bg-transparent outline-none text-gray-800 placeholder-gray-400 text-[15px]"
            />

            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-10 h-10 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-all"
            >
              <Send className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Navigation Bar */}
      <BottomNavBar currentView={currentView} onNavigate={handleNavigate} />
    </div>
  );
}