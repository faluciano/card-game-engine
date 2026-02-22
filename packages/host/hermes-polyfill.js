// hermes-polyfill.js — Must be imported FIRST, before any CouchKit code.
//
// Hermes exposes crypto.subtle.digest as a function, but calling it
// returns a Promise that never settles. This causes derivePlayerId()
// to hang forever. Deleting crypto.subtle forces the legacy fallback
// (synchronous js-sha1 hash).

console.log(
  "[BOOT] crypto:", typeof globalThis.crypto,
  "subtle:", typeof globalThis.crypto?.subtle,
  "digest:", typeof globalThis.crypto?.subtle?.digest,
);

if (globalThis.crypto?.subtle) {
  delete globalThis.crypto.subtle;
  console.log("[BOOT] Deleted crypto.subtle — forcing legacy derivePlayerId");
} else {
  console.log("[BOOT] crypto.subtle already absent — legacy path will be used");
}
