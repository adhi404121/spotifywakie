import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { TokenProvider } from "./contexts/TokenContext";

// If you set initial tokens from login/server, expose them on window.__INITIAL_TOKEN__ etc.
const initialToken = (window as any).__INITIAL_TOKEN__ ?? null;
const initialExpiresIn = (window as any).__INITIAL_TOKEN_EXPIRES_IN ?? undefined;

const Root = () => (
  <TokenProvider initialToken={initialToken} initialExpiresIn={initialExpiresIn}>
    <App />
  </TokenProvider>
);

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(<Root />);
}
