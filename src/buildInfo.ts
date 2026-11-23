// Written by tools/stamp-build.mjs before each Verse8 push: the source commit and when it was stamped (KST).
// Nothing in src reads this. vite.config.ts does, when it makes a build (`buildTag`): where there is no git checkout
// to ask, as on a builder that is handed the files only, this is how the build knows which commit it is. A build made
// from a checkout goes by its HEAD and only mentions this commit when it comes from another repository.
export const SOURCE_COMMIT = '8f5dab6';
export const STAMPED_AT = '11/20 09:35';
