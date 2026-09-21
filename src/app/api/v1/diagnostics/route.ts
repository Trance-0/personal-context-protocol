import { NextResponse, NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { APP_VERSION } from '@/lib/version';
import { logError } from '@/lib/logging';
import { validateRuntimeConfig } from '@/lib/config';
import { featureReport } from '@/lib/feature-report';

export const dynamic = 'force-dynamic';

/**
 * What this deployment actually is: `GET /api/v1/diagnostics` with the admin
 * token.
 *
 * Answering "is the server running correctly" previously meant probing routes
 * by hand and inferring the build from which ones 404ed — a deployment can be
 * healthy, authenticate fine, serve its data, and still be missing an entire
 * feature line because it was built from a branch that never received it. That
 * is invisible from `/health`, which only reports that the process is up.
 *
 * So this reports the build, the database, the environment and which feature
 * groups are actually present, in one request.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyUiToken(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    // Each probe is isolated: a database that is down must still yield a
    // report saying so, rather than a 500 that says nothing.
    const database = await probeDatabase();
    const counts = database.ok ? await probeCounts() : null;
    const migrations = database.ok ? await probeMigrations() : [];

    return NextResponse.json({
      build: {
        version: APP_VERSION,
        // Which commit is actually serving this request: the question a
        // version number alone cannot answer when two branches share one.
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
        branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
        runtime: `node ${process.version}`,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
      },
      database,
      counts,
      migrations,
      config: validateRuntimeConfig(process.env).issues,
      features: featureReport(migrations.map((row) => row.version)),
    });
  } catch (error) {
    logError({
      consequence: 'Unable to read diagnostics',
      moduleProcess: 'admin diagnostics / report assembly',
      cause: 'token verification or a diagnostic probe failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to read diagnostics: admin diagnostics / report assembly - internal error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

async function probeDatabase(): Promise<{ ok: boolean; latencyMs: number | null; error: string | null }> {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return { ok: true, latencyMs: Date.now() - started, error: null };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown database error',
    };
  }
}

/** Row counts, so "the app is up" can be told apart from "the app has data". */
async function probeCounts(): Promise<Record<string, number> | null> {
  try {
    const result = await db.execute(sql`
      select
        (select count(*) from topics)      as topics,
        (select count(*) from sessions)    as sessions,
        (select count(*) from messages)    as messages,
        (select count(*) from events)      as events,
        (select count(*) from session_tokens where not revoked) as active_tokens
    `);
    const row = (result as unknown as { rows?: Record<string, unknown>[] }).rows?.[0]
      ?? (result as unknown as Record<string, unknown>[])[0];
    if (!row) return null;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]));
  } catch {
    // A missing table is itself diagnostic, and is reported by `features`.
    return null;
  }
}

async function probeMigrations(): Promise<Array<{ version: string; appliedAt: string | null }>> {
  try {
    const result = await db.execute(sql`select version, applied_at from schema_migrations order by version`);
    const rows = (result as unknown as { rows?: Record<string, unknown>[] }).rows
      ?? (result as unknown as Record<string, unknown>[]);
    return (rows ?? []).map((row) => ({
      version: String(row.version),
      appliedAt: row.applied_at ? new Date(String(row.applied_at)).toISOString() : null,
    }));
  } catch {
    return [];
  }
}
