import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import { registerWebMcpTools } from "./webmcp/register";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

/**
 * Boot order matters (docs/ARCHITECTURE.md): tools register LAST, after the
 * stores exist, so no tool can ever be called against an empty world.
 *
 * Registration is deliberately outside React. It must happen exactly once per
 * document, and StrictMode double-invokes effects in development.
 */
void registerWebMcpTools();
