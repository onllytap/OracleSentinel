import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import "./monitoring/sentry";
import App from "./App.tsx";
import "./index.css";
import "./styles/animations.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<div>Une erreur est survenue. Rechargez la page.</div>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
