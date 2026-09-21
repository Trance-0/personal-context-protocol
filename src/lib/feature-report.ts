/**
 * Which feature lines this build actually carries.
 *
 * A deployment can be healthy, authenticate, serve its data, and still be
 * missing a whole feature line because it was built from a branch that never
 * received it. From the outside that is indistinguishable from a bug: the
 * routes simply 404, and the only way to tell "not deployed" from "broken" was
 * to probe by hand and reason about which build could produce that pattern.
 *
 * Each feature names the migration that introduces it, so presence is decided
 * by what the database has actually been migrated to rather than by guessing
 * from the version number — two branches can share a version and differ wildly
 * in content, which is exactly how this became confusing.
 */

export type Feature = {
  id: string
  label: string
  /** Migration that must be applied for this feature to work. */
  migration: string
  /** Representative routes, listed so a report can be checked against reality. */
  routes: string[]
  description: string
}

export const FEATURES: Feature[] = [
  {
    id: 'core',
    label: 'Core recording',
    migration: '001_initial',
    routes: ['/api/v1/health', '/api/v1/topics', '/api/v1/sessions'],
    description: 'Topics, sessions, messages and the admin surface.',
  },
  {
    id: 'agent',
    label: 'Agent recording',
    migration: '002_agent_recording',
    routes: ['/api/v1/agent/sessions/:id/messages', '/api/v1/agent/sessions/:id/compact'],
    description: 'Session tokens, compactions and token expiry.',
  },
  {
    id: 'public-sessions',
    label: 'Public sessions',
    migration: '006_public_session',
    routes: ['/api/v1/public/sessions/:id'],
    description: 'Read-only sharing of a session without the admin token.',
  },
  {
    id: 'scoped-tokens',
    label: 'Scoped tokens and manager API',
    migration: '008_scoped_tokens',
    routes: ['/api/v1/tokens', '/api/v1/manager/tree', '/api/v1/manager/sessions'],
    description: 'The global token manager: folder/session-scoped tokens and the manager surface.',
  },
  {
    id: 'session-links',
    label: 'Session links',
    migration: '009_session_links',
    routes: ['/api/v1/sessions/:id/links', '/api/v1/manager/sessions/:id/links'],
    description: 'Labelled relationships between sessions.',
  },
  {
    id: 'external-keys',
    label: 'External-key sync',
    migration: '010_external_session_keys',
    routes: ['/api/v1/manager/sessions/by-key/:key'],
    description: 'Idempotent push from an external sync worker, keyed by its own session identity.',
  },
]

export type FeatureStatus = Feature & { present: boolean }

/** Decide each feature from the migrations the database reports. */
export function featureReport(appliedMigrations: string[]): FeatureStatus[] {
  const applied = new Set(appliedMigrations)
  return FEATURES.map((feature) => ({ ...feature, present: applied.has(feature.migration) }))
}
