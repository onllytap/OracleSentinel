/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WIDGET_ID?: string;
  readonly VITE_COMPANY_PHONE?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_APP_RELEASE?: string;
  readonly VITE_GIT_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
