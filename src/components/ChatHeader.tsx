import React, { useEffect, useState } from 'react';
import { Settings, MessageSquare, Palette, X, Check, ArrowLeft, Maximize2, Minimize2, Bell, Plus, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useTheme, ThemeColor } from '../contexts/ThemeContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useToast } from '../contexts/ToastContext';
import { api, ConversationSummary } from '../services/api';

interface ChatHeaderProps {
  onClose?: () => void;
  onBack?: () => void;
  showBackButton?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onOpenSettings?: () => void;
}

export function ChatHeader({ onClose, onBack, showBackButton, isExpanded, onToggleExpand, onOpenSettings }: ChatHeaderProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const { theme, setTheme, colors, avatar, setAvatar } = useTheme();
  const { unreadCount } = useNotifications();
  const { showError } = useToast();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('chatWindow:sessionId:v1');
    } catch {
      return null;
    }
  });

  const handleNewConversation = () => {
    window.dispatchEvent(new CustomEvent('chat:newConversation'));
    setShowMenu(false);
    setActiveSessionId(null);
  };

  const handleSelectConversation = (sessionId: string) => {
    window.dispatchEvent(new CustomEvent('chat:selectConversation', { detail: { sessionId } }));
    setShowMenu(false);
    setActiveSessionId(sessionId);
  };

  useEffect(() => {
    if (!showMenu) return;

    let cancelled = false;
    setIsLoadingConversations(true);

    api.listConversations({ limit: 20, offset: 0 })
      .then((data) => {
        if (cancelled) return;
        setConversations(data);
      })
      .catch((e) => {
        console.error('Failed to load conversations', e);
        showError('Erreur de connexion, réessayez.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingConversations(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showMenu, showError]);

  const themes: Array<{ id: ThemeColor; name: string; colorClass: string; hex: string }> = [
    { id: 'violet', name: 'Violet', colorClass: 'bg-purple-600', hex: '#7C6FE8' },
    { id: 'blue', name: 'Bleu', colorClass: 'bg-blue-600', hex: '#4A90FF' },
    { id: 'green', name: 'Vert', colorClass: 'bg-green-600', hex: '#10B981' },
    { id: 'orange', name: 'Orange', colorClass: 'bg-orange-600', hex: '#F97316' },
  ];

  // Close menus when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-menu-container]')) {
        setShowMenu(false);
        setShowThemeMenu(false);
        setShowAvatarMenu(false);
      }
    };

    if (showMenu || showThemeMenu || showAvatarMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu, showThemeMenu, showAvatarMenu]);

  return (
    <div
      className={`relative px-5 py-4 pb-8 transition-all safe-area-top ${isExpanded ? 'sm:px-8 sm:py-5' : ''}`}
      style={{
        background: `linear-gradient(to bottom, ${colors.headerFrom}, ${colors.headerVia}, transparent)`
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Back Button */}
          {showBackButton && onBack && (
            <button
              onClick={onBack}
              className="w-9 h-9 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors border border-white/30"
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
          )}

          {/* Avatar Section with Dropdown */}
          <div className="relative" data-menu-container>
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/30 shadow-sm relative cursor-pointer" onClick={() => setShowAvatarMenu(!showAvatarMenu)}>
              <ImageWithFallback
                src={avatar}
                alt="AI Assistant"
                className="w-full h-full object-cover"
              />
            </div>

            {/* Dropdown Toggle Button (replaces green dot) */}
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => {
                e.stopPropagation();
                setShowAvatarMenu(!showAvatarMenu);
              }}
              className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-white rounded-full flex items-center justify-center shadow-sm border border-gray-200 text-gray-600 hover:text-blue-600 z-20 cursor-pointer"
            >
              <ChevronDown className="w-2.5 h-2.5" />
            </motion.button>

            {/* Avatar Selection Menu */}
            <AnimatePresence>
              {showAvatarMenu && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10, x: 0 }}
                  animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10, x: 0 }}
                  className="absolute top-10 left-0 w-60 bg-white rounded-xl shadow-xl border border-gray-100 p-2 z-50 origin-top-left"
                >
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-2 px-2 mt-1">Choisir l'avatar</p>
                  <div className="flex flex-col gap-1">
                    {[
                      { src: '/avatars/logo1.png', label: 'Cabinet IA (Logo)' },
                      { src: '/avatars/logo2.gif', label: 'Assistant Animé 1' },
                      { src: '/avatars/logo3.gif', label: 'Assistant Animé 2' },
                    ].map((item) => (
                      <button
                        key={item.src}
                        onClick={() => {
                          setAvatar(item.src);
                          setShowAvatarMenu(false);
                        }}
                        className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${avatar === item.src ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
                          }`}
                      >
                        <div className="w-8 h-8 rounded-full overflow-hidden border border-gray-200 flex-shrink-0">
                          <img src={item.src} alt={item.label} className="w-full h-full object-cover" />
                        </div>
                        <span className="text-sm font-medium">{item.label}</span>
                        {avatar === item.src && <Check className="w-4 h-4 ml-auto" />}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div>
            <h3 className="text-white text-base drop-shadow-sm">Cabinet IA</h3>
            <p className="text-white/80 text-xs">Online</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Conversation Menu Button */}
          <div className="relative">
            <button
              onClick={() => {
                setShowMenu(!showMenu);
                setShowThemeMenu(false);
              }}
              className="w-9 h-9 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors border border-white/30"
            >
              <MessageSquare className="w-4 h-4 text-white" />
            </button>

            <AnimatePresence>
              {showMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 top-12 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50 max-h-[300px] overflow-y-auto"
                >
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-sm text-gray-900 text-[12px] px-[21px] py-[0px]">Conversations</p>
                  </div>
                  <button
                    onClick={handleNewConversation}
                    className="w-full px-4 py-3 hover:bg-gray-50 text-left flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Plus className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-gray-900">Nouvelle conversation</p>
                      <p className="text-xs text-gray-500">Réinitialiser la session</p>
                    </div>
                  </button>

                  <div className="px-4 py-2 border-t border-gray-100">
                    <p className="text-sm text-gray-900 text-[12px] px-[21px] py-[0px]">Historique</p>
                  </div>

                  {isLoadingConversations ? (
                    <div className="px-4 py-3 text-xs text-gray-500">Chargement...</div>
                  ) : conversations.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-gray-500">Aucune conversation</div>
                  ) : (
                    conversations.map((c) => {
                      const isActive = activeSessionId === c.sessionId;
                      return (
                        <button
                          key={c.sessionId}
                          onClick={() => handleSelectConversation(c.sessionId)}
                          className="w-full px-4 py-3 hover:bg-gray-50 text-left flex items-center gap-3"
                        >
                          <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${isActive ? 'text-gray-900' : 'text-gray-700'} truncate`}>{c.sessionId}</p>
                            <p className="text-xs text-gray-500 truncate">{c.lastMessagePreview || '—'}</p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Theme Settings Button */}
          <div className="relative">
            <button
              onClick={() => {
                setShowThemeMenu(!showThemeMenu);
                setShowMenu(false);
              }}
              className="w-9 h-9 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors border border-white/30"
            >
              <Palette className="w-4 h-4 text-white" />
            </button>

            <AnimatePresence>
              {showThemeMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 top-12 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-3 z-50"
                >
                  <div className="px-4 pb-2 border-b border-gray-100 mb-2">
                    <p className="text-sm text-gray-900">Thème de couleur</p>
                  </div>
                  <div className="px-3 space-y-1">
                    {themes.map((themeOption) => (
                      <button
                        key={themeOption.id}
                        onClick={() => setTheme(themeOption.id)}
                        className="w-full px-3 py-2.5 hover:bg-gray-50 rounded-lg text-left flex items-center justify-between transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 ${themeOption.colorClass} rounded-full`}></div>
                          <span className="text-sm text-gray-900">{themeOption.name}</span>
                        </div>
                        {themeOption.id === theme && (
                          <Check className="w-4 h-4 text-blue-600" />
                        )}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Expand/Minimize Button */}
          {onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="hidden sm:flex w-9 h-9 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-lg items-center justify-center transition-colors border border-white/30"
            >
              {isExpanded ? <Minimize2 className="w-4 h-4 text-white" /> : <Maximize2 className="w-4 h-4 text-white" />}
            </button>
          )}

          {/* Notifications Button */}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="relative w-9 h-9 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors border border-white/30"
            >
              <Bell className="w-4 h-4 text-white" />
              {unreadCount > 0 && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center border-2 border-white shadow-lg">
                  <span className="text-white text-[10px]">{unreadCount > 9 ? '9+' : unreadCount}</span>
                </div>
              )}
            </button>
          )}

          {/* Close Button */}
          {onClose && (
            <button
              onClick={onClose}
              className="w-9 h-9 bg-white/20 backdrop-blur-sm hover:bg-red-500/90 rounded-lg flex items-center justify-center transition-all border border-white/30 hover:border-red-400 group"
            >
              <X className="w-4 h-4 text-white group-hover:rotate-90 transition-transform duration-300" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}