import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;
const DEFAULT_RELEASE = "premium-lead-generation-chatbot@0.1.0-local";

export function getReleaseName(): string {
  return (
    process.env.APP_RELEASE ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    DEFAULT_RELEASE
  );
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: getReleaseName(),
    integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()],
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    beforeSend(event) {
      const statusCode = event.extra?.statusCode;
      if (typeof statusCode === "number" && statusCode < 500) {
        return null;
      }
      return event;
    },
  });
}

export { Sentry };
