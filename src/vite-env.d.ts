/// <reference types="vite/client" />

/** Build stamp injected by vite.config.ts; shown in the lobby so a screenshot identifies the build. */
declare const __BUILD_ID__: string;
/** The corner badge's text (vite.config.ts `buildTag`); empty where no badge is wanted. */
declare const __BUILD_TAG__: string;

/**
 * Whether this build has the VX shop (vite.config.ts). False for a target that is not Verse8; read
 * bare, so the minifier drops the purchase code and its wording from such a build.
 */
declare const __VX__: boolean;

/** Whether this build loads the CrazyGames SDK (vite.config.ts): a CrazyGames build not made with CG_SDK=0. */
declare const __CG_SDK__: boolean;
