/**
 * gpm-core — pure prompt engines + renderer for Prompt Manager Pro.
 *
 * Self-contained: no DOM, no storage, no React. Imported INTO `frontend/`;
 * never imports back up. The renderer is transport-injected so the app owns
 * all I/O (e.g. `backendFetch`).
 */

export * from "./performance";
export * from "./shot";
export * from "./camera";
export * from "./workflow";
export * from "./renderer";
export * from "./ir";
