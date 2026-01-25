import React, { useState } from 'react';
import { MessageCircle, X, Minus } from 'lucide-react';
import { ChatWindow } from './ChatWindow';
import { ChatHeader } from './ChatHeader';
import { motion, AnimatePresence } from 'motion/react';
import { BottomNavBar } from './BottomNavBar';
import { HelpScreen } from './HelpScreen';
import { ContactScreen } from './ContactScreen';
import { SettingsScreen } from './SettingsScreen';
import { WelcomeScreen } from './WelcomeScreen';
import { MessagesWelcomeScreen } from './MessagesWelcomeScreen';
import { useNotifications } from '../contexts/NotificationContext';

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [currentView, setCurrentView] = useState<'home' | 'messages' | 'help' | 'contact' | 'settings'>('messages');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isChatStarted, setIsChatStarted] = useState(false);
  const { unreadCount } = useNotifications();

  const handleOpenChat = () => {
    setIsOpen(true);
  };

  return (
    <>
      {/* Backdrop en mode agrandi */}
      <AnimatePresence>
        {isOpen && isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
            onClick={() => setIsExpanded(false)}
          />
        )}
      </AnimatePresence>

      <div className={`fixed z-50 transition-all duration-300 ${isExpanded
        ? 'inset-4 sm:bottom-[50%] sm:right-[50%] sm:translate-x-[50%] sm:translate-y-[50%] sm:inset-auto'
        : 'bottom-6 right-6'
        }`}>
        <AnimatePresence>
          {isOpen ? (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{
                opacity: 1,
                scale: 1,
                y: 0,
              }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{
                type: 'spring',
                damping: 25,
                stiffness: 300,
                layout: { duration: 0.3, type: "spring", damping: 25, stiffness: 300 }
              }}
              className={`flex flex-col ${isExpanded
                ? 'w-full h-full sm:w-[800px] sm:h-[900px]'
                : 'w-[450px] h-[800px]'
                }`}
              style={{
                maxWidth: isExpanded ? '100%' : '450px',
                maxHeight: isExpanded ? '100%' : '95vh'
              }}
            >
              <div className="w-full h-full bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col relative">
                {/* Header */}
                <ChatHeader
                  onClose={() => setIsOpen(false)}
                  isExpanded={isExpanded}
                  onToggleExpand={() => setIsExpanded(!isExpanded)}
                  onOpenSettings={() => setCurrentView('settings')}
                />

                {/* Content Area */}
                {!isMinimized && (
                  <>
                    {currentView === 'messages' && (
                      isChatStarted ? <ChatWindow /> : <MessagesWelcomeScreen onStartChat={() => setIsChatStarted(true)} onOpenHelp={() => setCurrentView('help')} />
                    )}
                    {currentView === 'help' && <HelpScreen onBack={() => setCurrentView('messages')} />}
                    {currentView === 'home' && (
                      isChatStarted ? <ChatWindow /> : <WelcomeScreen onStartChat={() => setIsChatStarted(true)} onOpenHelp={() => setCurrentView('help')} />
                    )}
                    {currentView === 'contact' && <ContactScreen onBack={() => setCurrentView('messages')} />}
                    {currentView === 'settings' && <SettingsScreen onBack={() => setCurrentView('messages')} />}

                    {/* Bottom Navigation Bar */}
                    <BottomNavBar currentView={currentView} onNavigate={setCurrentView} />
                  </>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={handleOpenChat}
              className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-500 rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center group"
            >
              <MessageCircle className="w-7 h-7 text-white" />
              {unreadCount > 0 && (
                <div className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </div>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}