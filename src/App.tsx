import { ChatWidget } from './components/ChatWidget';
import { ThemeProvider } from './contexts/ThemeContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ToastProvider } from './contexts/ToastContext';

function App() {
  return (
    <ThemeProvider>
      <NotificationProvider>
        <ToastProvider>
          <ChatWidget />
        </ToastProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}

export default App;
