import React, { useState } from 'react';
import { Settings, MessageSquare, Palette, X, Check, ArrowLeft, Maximize2, Minimize2, Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useTheme, ThemeColor } from '../contexts/ThemeContext';
import { useNotifications } from '../contexts/NotificationContext';

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
  const { theme, setTheme, colors } = useTheme();
  const { unreadCount } = useNotifications();

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
      }
    };

    if (showMenu || showThemeMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu, showThemeMenu]);

  return (
    <div 
      className={`relative px-5 py-4 pb-8 transition-all ${isExpanded ? 'sm:px-8 sm:py-5' : ''}`}
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
          
          {/* Robot Avatar with Green Glow */}
          <div className="relative">
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-green-400 shadow-lg shadow-green-400/50">
              <ImageWithFallback
                src="https://images.unsplash.com/photo-1763788427834-95dec952e9cd?w=100&h=100&fit=crop"
                alt="AI Assistant"
                className="w-full h-full object-cover"
              />
            </div>
            {/* Green glow indicator */}
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-white shadow-lg shadow-green-400/50 animate-pulse"></div>
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
                  <button className="w-full px-4 py-3 hover:bg-gray-50 text-left flex items-center gap-3">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <div className="flex-1">
                      <p className="text-sm text-gray-900">Conversation actuelle</p>
                      <p className="text-xs text-gray-500">Il y a quelques instants</p>
                    </div>
                  </button>
                  <button className="w-full px-4 py-3 hover:bg-gray-50 text-left flex items-center gap-3">
                    <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">Précédente conversation</p>
                      <p className="text-xs text-gray-500">Il y a 2 jours</p>
                    </div>
                  </button>
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