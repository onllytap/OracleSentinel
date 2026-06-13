import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN;
const release =
  import.meta.env.VITE_APP_RELEASE ||
  import.meta.env.VITE_GIT_SHA ||
  'premium-lead-generation-chatbot@0.1.0-local';

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
  });
}
