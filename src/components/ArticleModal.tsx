import React from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ArticleModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
}

export function ArticleModal({ isOpen, onClose, title, content }: ArticleModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto"
          >
            <div className="bg-[#1A1A1A] rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-br from-[#5B4FDE] to-[#7C6FE8] px-5 py-4 flex items-center justify-between">
                <h2 className="text-white text-lg">{title}</h2>
                <button
                  onClick={onClose}
                  className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>

              {/* Content */}
              <div className="px-5 py-6 max-h-[60vh] overflow-y-auto">
                <p className="text-gray-300 leading-relaxed whitespace-pre-line">
                  {content}
                </p>
              </div>

              {/* Footer */}
              <div className="px-5 py-4 bg-[#0F0F0F] border-t border-gray-800">
                <button
                  onClick={onClose}
                  className="w-full bg-[#5B4FDE] hover:bg-[#6B5FEE] text-white rounded-xl py-3 transition-colors"
                >
                  Fermer
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
