import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/globals.css";
import { CommandCenter } from "./CommandCenter";

createRoot(document.getElementById("dashboard-root")!).render(
  <StrictMode>
    <div className="dark min-h-screen bg-background text-foreground antialiased">
      <CommandCenter />
    </div>
  </StrictMode>,
);
