// hermes-polyfill.js — Must be imported FIRST, before any CouchKit code.
//
// Hermes (React Native's JS engine) exposes crypto.subtle as an object
// but its methods throw at runtime. Delete it so CouchKit falls back
// to the synchronous legacy derivePlayerId path.

if (globalThis.crypto?.subtle) {
  delete globalThis.crypto.subtle;
}
