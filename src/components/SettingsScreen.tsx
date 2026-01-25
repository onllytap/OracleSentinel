import React, { useState } from 'react';
import { ArrowLeft, Bell, Mail, MessageSquare, Settings as SettingsIcon, Volume2, Moon, Globe, Shield, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useNotifications } from '../contexts/NotificationContext';
import { useTheme } from '../contexts/ThemeContext';

interface SettingsScreenProps {
  onBack: () => void;
}

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const { 
    notifications, 
    unreadCount, 
    markAsRead, 
    markAllAsRead, 
    clearNotifications,
    isNotificationsEnabled,
    toggleNotifications 
  } = useNotifications();
  const { colors } = useTheme();
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  };

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'À l\'instant';
    if (minutes < 60) return `Il y a ${minutes}min`;
    if (hours < 24) return `Il y a ${hours}h`;
    return `Il y a ${days}j`;
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'message':
        return <MessageSquare className="w-4 h-4" />;
      case 'system':
        return <SettingsIcon className="w-4 h-4" />;
      default:
        return <Bell className="w-4 h-4" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gradient-to-b from-blue-50/30 via-white to-white overflow-hidden">
      {/* Header with gradient */}
      <div 
        className="relative px-5 py-4"
        style={{
          background: `linear-gradient(to bottom, ${colors.headerFrom}, ${colors.headerVia}, transparent)`
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="w-9 h-9 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors border border-white/30"
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div>
              <h3 className="text-white text-base drop-shadow-sm">Notifications & Paramètres</h3>
              <p className="text-white/80 text-xs">
                {unreadCount > 0 ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Tout est lu'}
              </p>
            </div>
          </div>
          {notifications.length > 0 && (
            <button
              onClick={markAllAsRead}
              className="text-xs text-white/90 hover:text-white bg-white/10 px-3 py-1.5 rounded-lg backdrop-blur-sm"
            >
              Tout marquer lu
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Settings Section */}
        <div className="px-5 py-4 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h4 className="text-sm text-gray-900">Paramètres de notification</h4>
            </div>
            
            {/* Main Toggle */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div 
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${colors.primary}, ${colors.primaryLight})` }}
                >
                  <Bell className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-900">Activer les notifications</p>
                  <p className="text-xs text-gray-500">Recevoir des alertes en temps réel</p>
                </div>
              </div>
              <button
                onClick={() => {
                  toggleNotifications();
                  requestNotificationPermission();
                }}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  isNotificationsEnabled ? 'bg-green-500' : 'bg-gray-300'
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    isNotificationsEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Push Notifications */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-900">Notifications push</p>
                  <p className="text-xs text-gray-500">Alertes de nouveaux messages</p>
                </div>
              </div>
              <button
                onClick={() => setPushEnabled(!pushEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  pushEnabled ? 'bg-blue-500' : 'bg-gray-300'
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    pushEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Email Notifications */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center">
                  <Mail className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-900">Notifications par email</p>
                  <p className="text-xs text-gray-500">Résumé quotidien</p>
                </div>
              </div>
              <button
                onClick={() => setEmailEnabled(!emailEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  emailEnabled ? 'bg-purple-500' : 'bg-gray-300'
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    emailEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Sound */}
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-orange-50 rounded-xl flex items-center justify-center">
                  <Volume2 className="w-4 h-4 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-900">Sons de notification</p>
                  <p className="text-xs text-gray-500">Effet sonore</p>
                </div>
              </div>
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  soundEnabled ? 'bg-orange-500' : 'bg-gray-300'
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    soundEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Clear All Button */}
          {notifications.length > 0 && (
            <button
              onClick={clearNotifications}
              className="w-full px-4 py-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span className="text-sm">Supprimer toutes les notifications</span>
            </button>
          )}
        </div>

        {/* Notifications List */}
        <div className="px-5 pb-5">
          <div className="mb-3">
            <h4 className="text-sm text-gray-700">Historique</h4>
          </div>
          
          {notifications.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Bell className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 text-sm">Aucune notification</p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => (
                <motion.div
                  key={notification.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => markAsRead(notification.id)}
                  className={`bg-white rounded-xl shadow-sm border transition-all cursor-pointer ${
                    notification.read 
                      ? 'border-gray-100' 
                      : 'border-blue-200 bg-blue-50/30'
                  }`}
                >
                  <div className="px-4 py-3 flex gap-3">
                    <div 
                      className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        notification.type === 'message' 
                          ? 'bg-blue-50 text-blue-600' 
                          : notification.type === 'system'
                          ? 'bg-purple-50 text-purple-600'
                          : 'bg-green-50 text-green-600'
                      }`}
                    >
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm text-gray-900 font-medium">{notification.title}</p>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1" />
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mb-1">{notification.message}</p>
                      <p className="text-xs text-gray-400">{formatTimestamp(notification.timestamp)}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
