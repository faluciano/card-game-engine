// Expo entry-point shim — expo/AppEntry.js hardcodes `import App from '../../App'`
// relative to node_modules/expo/. Re-export the real App from src/.
export { default } from "./src/App";
