// WORKAROUND: Hermes exposes crypto.subtle.digest as a function but it
// returns a Promise that never settles, causing derivePlayerId to hang
// forever. Deleting subtle forces CouchKit to use derivePlayerIdLegacy
// (synchronous js-sha1 fallback). Remove once @couch-kit/core ships a
// timeout-guarded implementation.
if (globalThis.crypto?.subtle) {
  delete globalThis.crypto.subtle;
}

import { registerRootComponent } from "expo";
import App from "./src/App";

registerRootComponent(App);
