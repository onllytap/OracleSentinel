import React, { createContext, useContext, useState, useCallback } from 'react';

type Notification = {
  id: string;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  type: 'message' | 'system' | 'update';
};

type NotificationContextType = {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
  isNotificationsEnabled: boolean;
  toggleNotifications: () => void;
  playNotificationSound: () => void;
};

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([
    {
      id: '1',
      title: 'Bienvenue !',
      message: 'Merci d\'utiliser notre chatbot IA',
      timestamp: new Date(Date.now() - 3600000),
      read: false,
      type: 'system'
    }
  ]);
  const [isNotificationsEnabled, setIsNotificationsEnabled] = useState(true);

  const unreadCount = notifications.filter(n => !n.read).length;

  const playNotificationSound = useCallback(() => {
    if (!isNotificationsEnabled) return;
    try {
      const audio = new Audio('/sounds/notification.mp3');
      audio.volume = 0.375;
      audio.play().catch(console.error);
    } catch (e) {
      console.error('Audio play failed', e);
    }
  }, [isNotificationsEnabled]);

  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    if (!isNotificationsEnabled) return;

    // Play sound on notification
    playNotificationSound();

    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString(),
      timestamp: new Date(),
      read: false,
    };

    setNotifications(prev => [newNotification, ...prev]);

    // Browser notification if permission granted
    if (Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.message,
        icon: '/favicon.ico',
      });
    }
  }, [isNotificationsEnabled, playNotificationSound]);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev =>
      prev.map(n => ({ ...n, read: true }))
    );
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const toggleNotifications = useCallback(() => {
    setIsNotificationsEnabled(prev => !prev);
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearNotifications,
        isNotificationsEnabled,
        toggleNotifications,
        playNotificationSound,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
}
