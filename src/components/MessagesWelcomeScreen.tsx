import React from 'react';
import { MessageCircle, Mail, Clock, ChevronRight, Sparkles } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { motion } from 'motion/react';

interface MessagesWelcomeScreenProps {
  onStartChat: () => void;
  onOpenHelp?: () => void;
}

export function MessagesWelcomeScreen({ onStartChat, onOpenHelp }: MessagesWelcomeScreenProps) {
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
          className="absolute w-72 h-72 rounded-full blur-3xl opacity-15"
          style={{
            background: colors.primary,
            top: '15%',
            right: '10%'
          }}
          animate={{
            scale: [1, 1.25, 1],
            x: [0, -20, 0],
            y: [0, 25, 0],
          }}
          transition={{
            duration: 14,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />

        <motion.div
          className="absolute w-56 h-56 rounded-full blur-3xl opacity-12"
          style={{
            background: colors.secondary,
            bottom: '15%',
            left: '8%'
          }}
          animate={{
            scale: [1, 1.2, 1],
            x: [0, 15, 0],
            y: [0, -20, 0],
          }}
          transition={{
            duration: 11,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1.5
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
          className="text-gray-900 mb-3 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Vos Messages
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          className="text-gray-600 mb-8 text-[15px] leading-relaxed text-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          Consultez l'historique de vos conversations et démarrez un nouveau chat avec notre assistant IA
        </motion.p>

        {/* Stats Cards */}
        <motion.div
          className="grid grid-cols-2 gap-3 mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <motion.div
            className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-sm"
            whileHover={{ y: -3, scale: 1.02 }}
            transition={{ type: "spring", stiffness: 400 }}
          >
            <div className="flex items-center justify-center gap-2 mb-2">
              <Mail className="w-5 h-5" style={{ color: colors.primary }} strokeWidth={2} />
              <span className="text-2xl font-bold text-gray-900">0</span>
            </div>
            <div className="text-xs text-gray-600 font-medium">Messages reçus</div>
          </motion.div>

          <motion.div
            className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-white/60 shadow-sm"
            whileHover={{ y: -3, scale: 1.02 }}
            transition={{ type: "spring", stiffness: 400 }}
          >
            <div className="flex items-center justify-center gap-2 mb-2">
              <Clock className="w-5 h-5" style={{ color: colors.secondary }} strokeWidth={2} />
              <span className="text-2xl font-bold text-gray-900">24/7</span>
            </div>
            <div className="text-xs text-gray-600 font-medium">Disponibilité</div>
          </motion.div>
        </motion.div>

        {/* CTA Button */}
        <motion.div
          className="space-y-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <motion.button
            onClick={onStartChat}
            className="w-full px-6 py-4 text-white rounded-2xl transition-all duration-300 flex items-center justify-between group shadow-xl hover:shadow-2xl relative overflow-hidden"
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

            {/* Gradient Overlay on Hover */}
            <motion.div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(135deg, ${colors.secondary}, ${colors.primary})`,
              }}
              initial={{ opacity: 0 }}
              whileHover={{ opacity: 0.2 }}
              transition={{ duration: 0.3 }}
            />

            <span className="flex items-center gap-3 relative z-10">
              <MessageCircle className="w-5 h-5" strokeWidth={2} />
              <span className="font-semibold">Démarrer une conversation</span>
            </span>
            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform relative z-10" strokeWidth={2} />
          </motion.button>
        </motion.div>

        {/* Info Badge */}
        <motion.div
          className="mt-6 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-sm rounded-full border border-gray-200 shadow-sm">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-gray-600 font-medium">Assistant IA en ligne</span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}