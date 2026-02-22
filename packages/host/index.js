// Entry point — hermes-polyfill MUST be required first (before any
// CouchKit code) so that crypto.subtle is deleted before derivePlayerId
// captures a reference to it.
require("./hermes-polyfill");

import { registerRootComponent } from "expo";
import App from "./src/App";

registerRootComponent(App);
