import React, { useState, useEffect } from 'react';
import { X, Phone, MessageCircle } from 'lucide-react';
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

const hommeVert = '/gfx/homme-vert.png';

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [currentView, setCurrentView] = useState<'home' | 'messages' | 'help' | 'contact' | 'settings'>('messages');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isChatStarted, setIsChatStarted] = useState(false);
  const { unreadCount } = useNotifications();

  // 'card' is the detailed menu view
  const [launcherState, setLauncherState] = useState<'closed' | 'card'>('closed');

  // Responsive: detect mobile vs desktop
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    setIsMobile(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // @ts-ignore - Vite provides import.meta.env
  const COMPANY_PHONE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_COMPANY_PHONE) || '';
  const phoneLabel = String(COMPANY_PHONE || '').trim() || '0970 808 911';
  const telHref = `tel:${phoneLabel.replace(/[^\d+]/g, '')}`;

  const handleOpenChat = () => {
    setIsOpen(true);
    setLauncherState('closed');
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

      {/* Main container - positioning depends on state */}
      <div
        data-testid="chat-widget-root"
        className={`fixed z-50 transition-all duration-300 ${!isOpen
          ? '' // Launcher mode: positioned via style
          : isMobile
            ? 'inset-0' // Mobile open: fullscreen
            : isExpanded
              ? 'inset-4' // Desktop expanded: with margins
              : '' // Desktop normal: positioned via style
          }`}
        style={
          !isOpen || (!isMobile && !isExpanded)
            ? { bottom: isMobile ? '16px' : '24px', right: isMobile ? '16px' : '24px' }
            : {}
        }
      >
        <AnimatePresence>
          {isOpen ? (
            <motion.div
              data-testid="chat-panel"
              initial={{ opacity: 0, y: isMobile ? 0 : 20 }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              exit={{ opacity: 0, y: isMobile ? 0 : 20 }}
              transition={{
                type: 'spring',
                damping: 25,
                stiffness: 300
              }}
              className={`flex flex-col overflow-hidden transition-all duration-300 ease-in-out bg-transparent`}
              style={{
                width: isMobile ? '100%' : (isExpanded ? '800px' : '450px'),
                height: isMobile ? '100%' : (isExpanded ? '900px' : '700px'),
                maxWidth: isMobile ? '100%' : 'calc(100vw - 32px)',
                maxHeight: isMobile ? '100%' : 'calc(100vh - 32px)',
                flexShrink: 0, // Prevent shrinking
                flexGrow: 0,   // Prevent growing
              }}
            >
              {/* Main white container with CSS Grid layout */}
              <div
                className={`w-full h-full bg-white shadow-2xl overflow-hidden relative ${isMobile ? 'rounded-none' : 'rounded-3xl'}`}
                style={{
                  display: 'grid',
                  gridTemplateRows: 'auto minmax(0, 1fr)',
                  minHeight: 0,
                  maxWidth: '100%',
                }}
              >
                {/* Header - auto height */}
                <ChatHeader
                  onClose={() => {
                    setIsOpen(false);
                    setIsExpanded(false); // Reset expanded state when closing
                  }}
                  isExpanded={isExpanded}
                  onToggleExpand={() => setIsExpanded(!isExpanded)}
                  onOpenSettings={() => setCurrentView('settings')}
                />

                {/* Content Area - CSS Grid for proper height management */}
                {!isMinimized && (
                  <div
                    className="flex-1 overflow-hidden"
                    style={{
                      display: 'grid',
                      gridTemplateRows: 'minmax(0, 1fr) auto',
                      minHeight: 0,
                      maxWidth: '100%',
                      width: '100%',
                    }}
                  >
                    {/* Main View - takes remaining space with strict width */}
                    <div
                      className="overflow-hidden"
                      style={{ minHeight: 0, maxWidth: '100%', width: '100%' }}
                    >
                      {currentView === 'messages' && (
                        isChatStarted ? <ChatWindow /> : <MessagesWelcomeScreen onStartChat={() => setIsChatStarted(true)} onOpenHelp={() => setCurrentView('help')} />
                      )}
                      {currentView === 'help' && <HelpScreen onBack={() => setCurrentView('messages')} />}
                      {currentView === 'home' && (
                        isChatStarted ? <ChatWindow /> : <WelcomeScreen onStartChat={() => setIsChatStarted(true)} onOpenHelp={() => setCurrentView('help')} />
                      )}
                      {currentView === 'contact' && <ContactScreen onBack={() => setCurrentView('messages')} />}
                      {currentView === 'settings' && <SettingsScreen onBack={() => setCurrentView('messages')} />}
                    </div>

                    {/* Bottom Navigation Bar - fixed at bottom */}
                    <BottomNavBar currentView={currentView} onNavigate={setCurrentView} />
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <>
              {/* Click-outside backdrop for launcher menus */}
              <AnimatePresence>
                {launcherState === 'card' && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setLauncherState('closed')}
                    className="fixed inset-0 z-40 bg-transparent"
                  />
                )}
              </AnimatePresence>

              {/* Card Dropdown - Premium Redesign */}
              <AnimatePresence>
                {launcherState === 'card' && (
                  <motion.div
                    data-testid="chat-launcher-card"
                    initial={false}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="fixed z-50"
                    style={{
                      bottom: isMobile ? '100px' : '100px',
                      right: isMobile ? '16px' : '24px',
                      left: isMobile ? '16px' : 'auto',
                      width: isMobile ? 'auto' : '400px',
                    }}
                  >
                    <div
                      className="rounded-[2rem] overflow-hidden flex flex-col relative"
                      style={{
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.9) 50%, rgba(241,245,249,0.85) 100%)',
                        boxShadow: '0 25px 60px -15px rgba(0,0,0,0.25), 0 10px 30px -10px rgba(9,91,177,0.15), inset 0 1px 0 rgba(255,255,255,0.8)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255,255,255,0.6)',
                      }}
                    >
                      {/* Ambient Glow */}
                      <div className="absolute inset-0 rounded-[2rem] pointer-events-none overflow-hidden">
                        <motion.div
                          className="absolute -top-20 -right-20 w-40 h-40 rounded-full opacity-30"
                          style={{ background: 'radial-gradient(circle, #38bdf8 0%, transparent 70%)' }}
                          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.4, 0.3] }}
                          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                        />
                        <motion.div
                          className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full opacity-20"
                          style={{ background: 'radial-gradient(circle, #095bb1 0%, transparent 70%)' }}
                          animate={{ scale: [1, 1.15, 1], opacity: [0.2, 0.3, 0.2] }}
                          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                        />
                      </div>

                      {/* Top Section */}
                      <div className="p-6 pb-4 relative z-10">
                        {/* Badge Premium */}
                        <motion.div
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-3"
                          style={{
                            background: 'linear-gradient(135deg, rgba(9,91,177,0.1) 0%, rgba(56,189,248,0.1) 100%)',
                            border: '1px solid rgba(9,91,177,0.15)'
                          }}
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 }}
                        >
                          <motion.div
                            className="w-1.5 h-1.5 rounded-full bg-cyan-500"
                            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
                            transition={{ duration: 2, repeat: Infinity }}
                          />
                          <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: '#095bb1' }}>
                            OracleSentinel
                          </span>
                        </motion.div>

                        <motion.h3
                          className="text-[22px] font-bold text-slate-900 leading-tight mb-1.5"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.15 }}
                        >
                          Conseiller personnel
                        </motion.h3>
                        <motion.p
                          className="text-[14px] text-slate-700 leading-relaxed mb-6"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.2 }}
                        >
                          Accompagnement gratuit par un expert dédié
                        </motion.p>

                        {/* Action Buttons - Premium Style */}
                        <motion.div
                          className="flex gap-3"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.25 }}
                        >
                          {/* Phone Button */}
                          <motion.a
                            href={telHref}
                            className="flex-1 min-w-0 py-3 px-4 rounded-xl flex items-center justify-center gap-2 group relative overflow-hidden"
                            style={{
                              background: 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(248,250,252,0.8) 100%)',
                              border: '1.5px solid rgba(9,91,177,0.2)',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.8)'
                            }}
                            whileHover={{
                              scale: 1.02,
                              boxShadow: '0 4px 16px rgba(9,91,177,0.15), inset 0 1px 0 rgba(255,255,255,0.8)',
                              borderColor: 'rgba(9,91,177,0.4)'
                            }}
                            whileTap={{ scale: 0.98 }}
                          >
                            <Phone className="w-4 h-4 text-blue-900 group-hover:scale-110 transition-transform" />
                            <span className="text-[13px] font-semibold text-blue-900 whitespace-nowrap tabular-nums">{phoneLabel}</span>
                          </motion.a>

                          {/* Chat Button - Primary CTA */}
                          <motion.button
                            data-testid="open-chat-button"
                            onClick={handleOpenChat}
                            className="flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-white font-semibold text-[13px] relative overflow-hidden group"
                            style={{
                              background: 'linear-gradient(135deg, #02102b 0%, #095bb1 100%)',
                              boxShadow: '0 4px 20px rgba(9,91,177,0.35), inset 0 1px 0 rgba(255,255,255,0.1)'
                            }}
                            whileHover={{
                              scale: 1.02,
                              boxShadow: '0 6px 25px rgba(9,91,177,0.45), inset 0 1px 0 rgba(255,255,255,0.15)'
                            }}
                            whileTap={{ scale: 0.98 }}
                          >
                            {/* Shimmer Effect */}
                            <motion.div
                              className="absolute inset-0 opacity-0 group-hover:opacity-100"
                              style={{
                                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)',
                              }}
                              initial={{ x: '-100%' }}
                              whileHover={{ x: '100%' }}
                              transition={{ duration: 0.6, ease: "easeInOut" }}
                            />
                            <MessageCircle className="w-4 h-4 relative z-10" />
                            <span className="relative z-10">Ouvrir le chat</span>
                          </motion.button>
                        </motion.div>
                      </div>

                      {/* Bottom Section with Image - Enhanced */}
                      <div className="relative h-36 mt-auto overflow-hidden">
                        {/* Animated Gradient Background */}
                        <div className="absolute inset-0" style={{
                          background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 30%, #0369a1 60%, #075985 100%)'
                        }}>
                          {/* Animated Blobs */}
                          <motion.div
                            className="absolute -left-8 top-0 w-40 h-40 rounded-full opacity-60"
                            style={{ background: 'radial-gradient(circle, #22d3ee 0%, transparent 70%)' }}
                            animate={{
                              x: [0, 10, 0],
                              y: [0, -5, 0],
                              scale: [1, 1.1, 1]
                            }}
                            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                          />
                          <motion.div
                            className="absolute left-1/3 top-4 w-32 h-32 rounded-full opacity-50"
                            style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }}
                            animate={{
                              x: [0, -8, 0],
                              y: [0, 8, 0],
                              scale: [1, 1.15, 1]
                            }}
                            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                          />
                          <motion.div
                            className="absolute right-0 bottom-0 w-36 h-36 rounded-full opacity-30"
                            style={{ background: 'radial-gradient(circle, #0284c7 0%, transparent 70%)' }}
                            animate={{
                              scale: [1, 1.2, 1],
                              opacity: [0.3, 0.4, 0.3]
                            }}
                            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 2 }}
                          />
                        </div>

                        {/* Man Image - Enhanced positioning */}
                        <motion.img
                          src={hommeVert}
                          alt="Conseiller"
                          className="absolute left-2 bottom-0 w-44 h-auto object-cover object-top z-10 drop-shadow-2xl"
                          style={{
                            maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
                            WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)'
                          }}
                          initial={{ opacity: 0, y: 20, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
                        />

                        {/* Close Button - Refined */}
                        <motion.button
                          onClick={() => setLauncherState('closed')}
                          className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-white/90 hover:text-white transition-colors z-20 group"
                          style={{
                            background: 'rgba(255,255,255,0.15)',
                            backdropFilter: 'blur(10px)',
                            border: '1px solid rgba(255,255,255,0.2)'
                          }}
                          whileHover={{
                            background: 'rgba(255,255,255,0.25)',
                            scale: 1.02
                          }}
                          whileTap={{ scale: 0.98 }}
                        >
                          Fermer
                          <X className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-300" />
                        </motion.button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Main Launcher (Pill or Circle) - Premium Enhanced */}
              <AnimatePresence>
                {launcherState === 'closed' && (
                  <motion.div
                    key="launcher-pill"
                    initial={false}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {/* --- DESKTOP VERSION (Large Pill) - Enhanced --- */}
                    {!isMobile && (
                      <motion.div
                        data-testid="chat-launcher"
                        role="button"
                        aria-label="Ouvrir les options du chat"
                        tabIndex={0}
                        onClick={() => setLauncherState('card')}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setLauncherState('card'); }}
                        className="flex group relative items-center justify-between cursor-pointer overflow-visible"
                        style={{
                          height: '68px',
                          width: 'auto',
                          minWidth: '360px',
                          maxWidth: 'calc(100vw - 2rem)',
                          borderRadius: '100px',
                          paddingRight: '28px',
                          background: 'linear-gradient(135deg, #02102b 0%, #0a3d7a 50%, #095bb1 100%)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          boxShadow: '0 10px 40px -10px rgba(9,91,177,0.5), 0 4px 20px -5px rgba(0,0,0,0.3)'
                        }}
                        whileHover={{
                          scale: 1.03,
                          boxShadow: '0 15px 50px -10px rgba(9,91,177,0.6), 0 6px 25px -5px rgba(0,0,0,0.35)'
                        }}
                        whileTap={{ scale: 0.98 }}
                      >
                        {/* Animated Shine effect */}
                        <motion.div
                          className="absolute inset-0 rounded-full overflow-hidden pointer-events-none"
                          style={{ borderRadius: '100px' }}
                        >
                          <motion.div
                            className="absolute inset-0"
                            style={{
                              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)',
                            }}
                            animate={{ x: ['-100%', '200%'] }}
                            transition={{ duration: 3, repeat: Infinity, repeatDelay: 2, ease: "easeInOut" }}
                          />
                        </motion.div>

                        {/* Ambient Glow decorations */}
                        <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none" style={{ borderRadius: '100px' }}>
                          <motion.div
                            className="absolute -left-6 -top-10 w-28 h-28 rounded-full"
                            style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.2) 0%, transparent 70%)' }}
                            animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.3, 0.2] }}
                            transition={{ duration: 4, repeat: Infinity }}
                          />
                          <motion.div
                            className="absolute right-1/4 bottom-0 w-24 h-24 rounded-full"
                            style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)' }}
                            animate={{ scale: [1, 1.15, 1], opacity: [0.15, 0.25, 0.15] }}
                            transition={{ duration: 5, repeat: Infinity, delay: 1 }}
                          />
                        </div>

                        {/* Image Container */}
                        <div className="relative -ml-2 -mt-2 flex-shrink-0 z-20" style={{ width: '88px', height: '88px' }}>
                          <motion.div
                            className="absolute bottom-0 left-0 w-full h-full flex items-end justify-center"
                            whileHover={{ scale: 1.05 }}
                            transition={{ type: "spring", stiffness: 300 }}
                          >
                            <img
                              src={hommeVert}
                              alt="Conseiller"
                              className="w-[145%] max-w-none h-[145%] object-contain object-bottom drop-shadow-2xl"
                              style={{ transform: 'translate(2px, -12px) scale(1.1)' }}
                            />
                          </motion.div>
                          {unreadCount > 0 && (
                            <motion.div
                              className="absolute top-0 right-0 w-5 h-5 rounded-full border-2 border-white z-30 flex items-center justify-center transform translate-x-1 -translate-y-1"
                              style={{ backgroundColor: '#dc2626', boxShadow: '0 2px 8px rgba(220,38,38,0.5)' }}
                              animate={{ scale: [1, 1.1, 1] }}
                              transition={{ duration: 2, repeat: Infinity }}
                            >
                              <span className="text-[11px] font-bold text-white leading-none">{unreadCount > 9 ? '9+' : unreadCount}</span>
                            </motion.div>
                          )}
                        </div>

                        {/* Text Content */}
                        <div className="flex-1 text-left pl-5 z-10 flex flex-col justify-center min-w-0">
                          <motion.div
                            className="text-[11px] font-bold uppercase tracking-wider leading-tight mb-0.5 truncate flex items-center gap-1.5"
                            style={{ color: '#38bdf8', letterSpacing: '0.08em' }}
                          >
                            <motion.span
                              className="w-1.5 h-1.5 rounded-full bg-cyan-400"
                              animate={{ opacity: [1, 0.5, 1] }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                            />
                            Exclu IONOS
                          </motion.div>
                          <div
                            className="leading-tight whitespace-nowrap truncate font-medium"
                            style={{ color: '#ffffff', fontSize: '19px' }}
                          >
                            Conseiller LIVE
                          </div>
                        </div>

                        {/* 'Plus' Button - Enhanced */}
                        <motion.div
                          className="flex items-center gap-1.5 pl-6 pr-0 text-[13px] font-semibold z-10 whitespace-nowrap flex-shrink-0"
                          style={{ color: 'white' }}
                          whileHover={{ x: 3 }}
                        >
                          Plus
                          <motion.span
                            style={{ color: '#38bdf8' }}
                            animate={{ x: [0, 3, 0] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          >
                            →
                          </motion.span>
                        </motion.div>
                      </motion.div>
                    )}

                    {/* --- MOBILE VERSION (Mini) - Enhanced --- */}
                    {isMobile && (
                      <motion.div
                        data-testid="chat-launcher"
                        role="button"
                        aria-label="Ouvrir les options du chat"
                        tabIndex={0}
                        onClick={() => setLauncherState('card')}
                        className="flex group relative items-center justify-center cursor-pointer"
                        style={{
                          width: '76px',
                          height: '76px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #02102b 0%, #0a3d7a 50%, #095bb1 100%)',
                          border: '2px solid rgba(255,255,255,0.15)',
                          boxShadow: '0 8px 32px -8px rgba(9,91,177,0.6), 0 4px 16px -4px rgba(0,0,0,0.3)'
                        }}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        {/* Pulse Ring Animation */}
                        <motion.div
                          className="absolute inset-0 rounded-full"
                          style={{ border: '2px solid rgba(56,189,248,0.4)' }}
                          animate={{
                            scale: [1, 1.3, 1.3],
                            opacity: [0.6, 0, 0]
                          }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                        />

                        {/* Internal Glow/Blobs */}
                        <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
                          <motion.div
                            className="absolute top-0 right-0 w-full h-full rounded-full"
                            style={{ background: 'radial-gradient(circle at top right, rgba(56,189,248,0.2) 0%, transparent 60%)' }}
                            animate={{ opacity: [0.2, 0.35, 0.2] }}
                            transition={{ duration: 3, repeat: Infinity }}
                          />
                          <motion.div
                            className="absolute -bottom-2 -left-2 w-12 h-12 rounded-full"
                            style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.4) 0%, transparent 70%)' }}
                            animate={{ scale: [1, 1.2, 1] }}
                            transition={{ duration: 4, repeat: Infinity }}
                          />
                        </div>

                        {/* Image centered and popping out */}
                        <div className="relative w-full h-full">
                          <motion.div
                            className="absolute bottom-0 left-0 w-full h-[115%] flex items-end justify-center overflow-visible"
                            whileHover={{ scale: 1.05 }}
                          >
                            <img
                              src={hommeVert}
                              alt="Chat"
                              className="w-[95%] h-auto object-cover object-bottom"
                              style={{
                                maskImage: 'linear-gradient(to bottom, black 88%, transparent 100%)',
                                WebkitMaskImage: 'linear-gradient(to bottom, black 88%, transparent 100%)',
                                transform: 'translateY(2px) scale(1.35)',
                                filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))'
                              }}
                            />
                          </motion.div>
                        </div>

                        {/* Notification Badge */}
                        {unreadCount > 0 && (
                          <motion.div
                            className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-600 border-2 border-white flex items-center justify-center z-20"
                            style={{ boxShadow: '0 2px 8px rgba(220,38,38,0.5)' }}
                            animate={{ scale: [1, 1.15, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          >
                            <span className="text-[10px] font-bold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>
                          </motion.div>
                        )}
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
