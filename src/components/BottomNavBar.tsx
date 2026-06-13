import React from 'react';
import { Home, MessageSquare, HelpCircle, Phone } from 'lucide-react';

interface BottomNavBarProps {
  currentView: 'home' | 'messages' | 'help' | 'contact' | 'settings';
  onNavigate: (view: 'home' | 'messages' | 'help' | 'contact' | 'settings') => void;
}

export function BottomNavBar({ currentView, onNavigate }: BottomNavBarProps) {
  const navItems = [
    { id: 'home' as const, label: 'Home', icon: Home },
    { id: 'messages' as const, label: 'Messages', icon: MessageSquare },
    { id: 'help' as const, label: 'Help', icon: HelpCircle },
    { id: 'contact' as const, label: 'Contact', icon: Phone },
  ];

  return (
    <div data-testid="bottom-nav" className="bg-[#1A1A1A] border-t border-gray-800 safe-area-bottom">
      <div className="flex items-center justify-around px-4 py-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;

          return (
            <button
              key={item.id}
              data-testid={`bottom-nav-${item.id}`}
              onClick={() => onNavigate(item.id)}
              className="flex flex-col items-center gap-1 min-w-[60px] transition-colors"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${isActive ? 'bg-[#5B4FDE]' : 'bg-transparent'
                }`}>
                <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-gray-300'}`} />
              </div>
              <span className={`text-xs ${isActive ? 'text-white' : 'text-gray-300'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Powered by */}
      <div className="text-center pb-2 pt-1">
        <p className="text-gray-300 text-xs flex items-center justify-center gap-1">
          <span className="text-gray-300">⚡</span> Powered by <span className="text-gray-200">OracleSentinel</span>
        </p>
      </div>
    </div>
  );
}
