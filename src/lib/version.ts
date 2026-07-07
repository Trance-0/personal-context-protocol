/**
 * Runtime app version. `PCP_VERSION` is set by Docker builds; npm sets
 * `npm_package_version` when scripts run locally. The fallback must match the
 * root VERSION file and is checked by scripts/version-check.js.
 */
export const APP_VERSION = process.env.PCP_VERSION || process.env.npm_package_version || '0.1.23';
