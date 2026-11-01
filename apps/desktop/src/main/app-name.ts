/**
 * User-visible product name for the desktop shell.
 *
 * Kept local rather than imported from `@aimarkdown/shared`: the packaged main process is plain
 * CommonJS and must not require a workspace package at runtime. Keep in sync with `APP_NAME` in
 * `packages/shared/src/constants.ts`.
 */
export const APP_NAME = 'AiMD';
