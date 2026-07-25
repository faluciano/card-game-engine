import { createRoot } from "react-dom/client";
import { App } from "./App.js";

// No StrictMode: it double-invokes effects/initializers in dev, which would open
// two relay connections and create the room twice. The display host is a single
// long-lived connection.
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<App />);
