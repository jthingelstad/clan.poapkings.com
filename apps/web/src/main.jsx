import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { loadTinylytics } from "./analytics.js";
// Elixir's design system, from the pinned elixir-mcp dependency: the same
// tokens, chrome, chips and cards as elixir.poapkings.com. Never a copy.
import "elixir-mcp/packages/design/styles.css";

createRoot(document.getElementById("root")).render(<App />);
loadTinylytics();
