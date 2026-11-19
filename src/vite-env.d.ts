/// <reference types="vite/client" />

/** Build stamp injected by vite.config.ts; shown in the lobby so a screenshot identifies the build. */
declare const __BUILD_ID__: string;

/**
 * Whether this build has the VX shop (vite.config.ts). False for a target that is not Verse8; read
 * bare, so the minifier drops the purchase code and its wording from such a build.
 */
declare const __VX__: boolean;
