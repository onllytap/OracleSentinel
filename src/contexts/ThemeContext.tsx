import React, { createContext, useContext, useState, ReactNode } from 'react';

export type ThemeColor = 'violet' | 'blue' | 'green' | 'orange';

interface ThemeColors {
  primary: string;
  primaryLight: string;
  secondary: string;
  gradient: string;
  botBubbleFrom: string;
  botBubbleVia: string;
  botBubbleTo: string;
  userBubbleFrom: string;
  userBubbleTo: string;
  headerFrom: string;
  headerVia: string;
  backgroundFrom: string;
  backgroundVia: string;
  backgroundTo: string;
}

const themes: Record<ThemeColor, ThemeColors> = {
  violet: {
    primary: '#5B4FDE',
    primaryLight: '#A99BF5',
    secondary: '#7C6FE8',
    gradient: 'from-[#5B4FDE] to-[#7C6FE8]',
    botBubbleFrom: '#7C6FE8',
    botBubbleVia: '#A99BF5',
    botBubbleTo: '#FFFFFF',
    userBubbleFrom: '#5B4FDE',
    userBubbleTo: '#4A3FCD',
    headerFrom: '#5B4FDE',
    headerVia: '#7C6FE8',
    backgroundFrom: '#5B4FDE',
    backgroundVia: '#9B8FF5',
    backgroundTo: '#FFFFFF',
  },
  blue: {
    primary: '#4A90FF',
    primaryLight: '#7AB8FF',
    secondary: '#6BA8FF',
    gradient: 'from-[#4A90FF] to-[#6BA8FF]',
    botBubbleFrom: '#4A90FF',
    botBubbleVia: '#7AB8FF',
    botBubbleTo: '#FFFFFF',
    userBubbleFrom: '#4A90FF',
    userBubbleTo: '#2B7EFF',
    headerFrom: '#4A90FF',
    headerVia: '#6BA8FF',
    backgroundFrom: '#4A90FF',
    backgroundVia: '#7AB8FF',
    backgroundTo: '#FFFFFF',
  },
  green: {
    primary: '#10B981',
    primaryLight: '#6EE7B7',
    secondary: '#34D399',
    gradient: 'from-[#10B981] to-[#34D399]',
    botBubbleFrom: '#10B981',
    botBubbleVia: '#6EE7B7',
    botBubbleTo: '#FFFFFF',
    userBubbleFrom: '#10B981',
    userBubbleTo: '#059669',
    headerFrom: '#10B981',
    headerVia: '#34D399',
    backgroundFrom: '#10B981',
    backgroundVia: '#6EE7B7',
    backgroundTo: '#FFFFFF',
  },
  orange: {
    primary: '#F97316',
    primaryLight: '#FDBA74',
    secondary: '#FB923C',
    gradient: 'from-[#F97316] to-[#FB923C]',
    botBubbleFrom: '#F97316',
    botBubbleVia: '#FDBA74',
    botBubbleTo: '#FFFFFF',
    userBubbleFrom: '#F97316',
    userBubbleTo: '#EA580C',
    headerFrom: '#F97316',
    headerVia: '#FB923C',
    backgroundFrom: '#F97316',
    backgroundVia: '#FDBA74',
    backgroundTo: '#FFFFFF',
  },
};

interface ThemeContextType {
  theme: ThemeColor;
  setTheme: (theme: ThemeColor) => void;
  colors: ThemeColors;
  avatar: string;
  setAvatar: (avatar: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeColor>('violet');
  const [avatar, setAvatarState] = useState<string>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('chatWindow:avatar:v1');
        return saved || '/avatars/logo3.gif'; // Default to one of the new gifs as requested "logo2 or logo3"
      }
    } catch { }
    return '/avatars/logo3.gif';
  });

  const setAvatar = (newAvatar: string) => {
    setAvatarState(newAvatar);
    try {
      localStorage.setItem('chatWindow:avatar:v1', newAvatar);
    } catch { }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, colors: themes[theme], avatar, setAvatar }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
