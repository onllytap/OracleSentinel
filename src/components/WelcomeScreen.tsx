import React from 'react';
import { Send, MessageSquare, Search, ChevronRight } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { motion } from 'motion/react';

interface WelcomeScreenProps {
  onStartChat: () => void;
  onOpenHelp?: () => void;
}

export function WelcomeScreen({ onStartChat, onOpenHelp }: WelcomeScreenProps) {
  const { colors } = useTheme();

  return (
    <div
      className="h-full flex flex-col items-center justify-center p-6 sm:p-8 relative overflow-hidden"
      style={{
        background: 'white'
      }}
    >
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute w-64 h-64 rounded-full blur-3xl opacity-20"
          style={{
            background: colors.primary,
            top: '10%',
            left: '5%'
          }}
          animate={{
            scale: [1, 1.2, 1],
            x: [0, 30, 0],
            y: [0, -20, 0],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />

        <motion.div
          className="absolute w-64 h-64 rounded-full blur-3xl opacity-15"
          style={{
            background: colors.secondary,
            bottom: '10%',
            right: '5%'
          }}
          animate={{
            scale: [1, 1.3, 1],
            x: [0, -25, 0],
            y: [0, 15, 0],
          }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1
          }}
        />
      </div>

      {/* Content */}
      <motion.div
        className="relative z-10 text-center max-w-md w-full"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        {/* Title */}
        <motion.h1
          className="text-gray-900 mb-4 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Bienvenue sur notre chatbot
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          className="text-gray-600 mb-8 text-[15px] leading-relaxed text-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          Discutez avec notre assistant IA pour découvrir nos services et trouver la solution adaptée à vos besoins
        </motion.p>

        {/* Action Buttons */}
        <motion.div
          className="space-y-3 mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <motion.button
            onClick={onStartChat}
            className="w-full px-6 py-4 text-white rounded-2xl transition-all duration-300 flex items-center justify-between group shadow-lg hover:shadow-2xl relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`,
            }}
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.98 }}
          >
            {/* Shimmer Effect */}
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
              initial={{ x: '-100%' }}
              whileHover={{ x: '100%' }}
              transition={{ duration: 0.6 }}
            />

            <span className="flex items-center gap-3 relative z-10">
              <Send className="w-5 h-5" strokeWidth={2} />
              <span className="font-semibold">Démarrer une conversation</span>
            </span>
            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform relative z-10" strokeWidth={2} />
          </motion.button>

          {onOpenHelp && (
            <motion.button
              onClick={onOpenHelp}
              className="w-full px-6 py-4 bg-white text-gray-700 rounded-2xl hover:bg-gray-50 transition-all duration-300 flex items-center justify-between group shadow-md hover:shadow-lg border border-gray-200"
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="flex items-center gap-3">
                <Search className="w-5 h-5" style={{ color: colors.primary }} strokeWidth={2} />
                <span className="font-semibold">Centre d'aide</span>
              </span>
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" strokeWidth={2} />
            </motion.button>
          )}
        </motion.div>

        {/* Trust Badge */}
        <motion.div
          className="mt-6 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-sm rounded-full border border-gray-200 shadow-sm">
            <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-xs text-gray-600 font-medium">Conforme RGPD • Données sécurisées</span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}