import React from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

interface ContactScreenProps {
  onBack?: () => void;
}

const socialLinks = [
  {
    name: 'WhatsApp',
    icon: '💬',
    url: 'https://wa.me/1234567890',
    description: 'Discutez avec nous instantanément',
    color: '#25D366',
  },
  {
    name: 'Site Internet',
    icon: '🌐',
    url: 'https://tsindustry.com',
    description: 'Visitez notre site web',
    color: '#4A90FF',
  },
  {
    name: 'LinkedIn',
    icon: '💼',
    url: 'https://linkedin.com/company/tsindustry',
    description: 'Suivez-nous sur LinkedIn',
    color: '#0A66C2',
  },
  {
    name: 'Twitter',
    icon: '🐦',
    url: 'https://twitter.com/tsindustry',
    description: 'Retrouvez-nous sur Twitter',
    color: '#1DA1F2',
  },
  {
    name: 'YouTube',
    icon: '▶️',
    url: 'https://youtube.com/@tsindustry',
    description: 'Nos vidéos et tutoriels',
    color: '#FF0000',
  },
  {
    name: 'Reddit',
    icon: '🤖',
    url: 'https://reddit.com/r/tsindustry',
    description: 'Rejoignez notre communauté',
    color: '#FF4500',
  },
  {
    name: 'Instagram',
    icon: '📸',
    url: 'https://instagram.com/tsindustry',
    description: 'Nos actualités en images',
    color: '#E4405F',
  },
  {
    name: 'Facebook',
    icon: '👥',
    url: 'https://facebook.com/tsindustry',
    description: 'Notre page Facebook',
    color: '#1877F2',
  },
  {
    name: 'GitHub',
    icon: '⚡',
    url: 'https://github.com/tsindustry',
    description: 'Nos projets open source',
    color: '#181717',
  },
  {
    name: 'Email',
    icon: '✉️',
    url: 'mailto:contact@tsindustry.com',
    description: 'Envoyez-nous un email',
    color: '#EA4335',
  },
];

export function ContactScreen({ onBack }: ContactScreenProps) {
  const { colors } = useTheme();

  return (
    <div className="flex-1 flex flex-col bg-[#1A1A1A] h-full">
      {/* Header */}
      <div 
        className="px-5 py-6 pb-8"
        style={{
          background: `linear-gradient(to bottom, ${colors.primary}, ${colors.secondary})`
        }}
      >
        <div className="flex items-center justify-between mb-4">
          {onBack && (
            <button
              onClick={onBack}
              className="w-9 h-9 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors border border-white/30"
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
          )}
          <h1 className="text-white text-2xl flex-1 text-center">Contact</h1>
          <div className="w-9"></div> {/* Spacer for centering */}
        </div>
        
        <p className="text-white/90 text-center text-sm">
          Connectez-vous avec nous sur vos plateformes préférées
        </p>
      </div>

      {/* Social Links */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="space-y-3">
          {socialLinks.map((link, index) => (
            <a
              key={index}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-[#252525] hover:bg-[#2F2F2F] rounded-xl p-4 transition-all border border-gray-800 hover:border-gray-700 group"
            >
              <div className="flex items-center gap-4">
                {/* Icon */}
                <div 
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shadow-lg"
                  style={{ backgroundColor: `${link.color}20` }}
                >
                  {link.icon}
                </div>
                
                {/* Content */}
                <div className="flex-1">
                  <h3 className="text-white text-base mb-0.5 flex items-center gap-2">
                    {link.name}
                    <ExternalLink className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-400 transition-colors" />
                  </h3>
                  <p className="text-gray-400 text-sm">{link.description}</p>
                </div>

                {/* Arrow */}
                <div className="text-gray-600 group-hover:text-gray-400 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Info Footer */}
      <div className="px-5 py-4 bg-[#0F0F0F] border-t border-gray-800">
        <p className="text-center text-gray-500 text-xs">
          Nous sommes disponibles du lundi au vendredi, 9h-18h
        </p>
      </div>
    </div>
  );
}
