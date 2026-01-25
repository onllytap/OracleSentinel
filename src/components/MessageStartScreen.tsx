import React from 'react';
import { MessageSquare } from 'lucide-react';
import { motion } from 'motion/react';
import { useTheme } from '../contexts/ThemeContext';

interface MessageStartScreenProps {
  onStartChat: () => void;
}

export function MessageStartScreen({ onStartChat }: MessageStartScreenProps) {
  const { colors } = useTheme();

  return (
    <motion.div
      className="flex flex-col items-center justify-center h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <MessageSquare
        className="w-16 h-16"
        style={{ color: colors.primary }}
      />
      <button
        className="mt-4 px-4 py-2 bg-primary text-white rounded-full"
        onClick={onStartChat}
      >
        Start Chat
      </button>
    </motion.div>
  );
}