import React, { useState } from 'react';
import { ChatWidget } from './components/ChatWidget';
import { MobileChatView } from './components/MobileChatView';
import { ThemeProvider } from './contexts/ThemeContext';
import { NotificationProvider } from './contexts/NotificationContext';

export default function App() {
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');

  return (
    <ThemeProvider>
      <NotificationProvider>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
          {/* Demo Controls */}
          <div className="fixed top-4 left-4 z-50 flex gap-2">
            <button
              onClick={() => setViewMode('desktop')}
              className={`px-4 py-2 rounded-xl transition-all ${
                viewMode === 'desktop'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Desktop Widget
            </button>
            <button
              onClick={() => setViewMode('mobile')}
              className={`px-4 py-2 rounded-xl transition-all ${
                viewMode === 'mobile'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Mobile Fullscreen
            </button>
          </div>

          {/* Content */}
          {viewMode === 'desktop' ? (
            <div className="flex items-center justify-center min-h-screen p-8">
              <div className="max-w-6xl w-full text-center">
                <h1 className="text-slate-800 mb-4">
                  Votre site web
                </h1>
                <p className="text-slate-600">
                  Le chatbot apparaît en bas à droite de votre page
                </p>
              </div>
              <ChatWidget />
            </div>
          ) : (
            <MobileChatView />
          )}
        </div>
      </NotificationProvider>
    </ThemeProvider>
  );
}