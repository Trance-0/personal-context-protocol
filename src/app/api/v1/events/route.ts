import { NextResponse, NextRequest } from 'next/server';
import { desc, eq, and, inArray, type SQL } from 'drizzle-orm';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { events, sessions } from '@/lib/schema';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * The instance-wide activity log: `GET /api/v1/events` with the admin token.
 *
 * Every write path already records an event — a session created, messages
 * appended, a token minted or revoked — but until now nothing read them back,
 * so the table grew and answered no questions. A per-session view exists at
 * `/sessions/:id/events`; this is the same data across the whole instance,
 * which is what "what has this server been doing" actually needs.
 *
 * Deliberately not a request log. On serverless each instance would keep its
 * own in-memory buffer and the result would be a partial, confusing picture;
 * these events are in Postgres, so every reader sees the same history.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyUiToken(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    const params = request.nextUrl.searchParams;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get('limit')) || DEFAULT_LIMIT));

    const filters: SQL[] = [];
    const action = params.get('action');
    if (action) filters.push(eq(events.action, action));
    const actor = params.get('actor');
    if (actor) filters.push(eq(events.actor, actor));
    const sessionId = params.get('session_id');
    if (sessionId) filters.push(eq(events.sessionId, sessionId));

    const rows = await db
      .select({
        id: events.id,
        action: events.action,
        actor: events.actor,
        sessionId: events.sessionId,
        topicId: events.topicId,
        details: events.detailsJson,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(events.createdAt))
      .limit(limit);

    // Session titles resolved in one query: an id alone does not say which
    // conversation a line is about, which is most of why a log is read.
    const ids = [...new Set(rows.map((row) => row.sessionId).filter((id): id is string => Boolean(id)))];
    const titles = ids.length
      ? new Map(
          (await db.select({ id: sessions.id, title: sessions.title }).from(sessions).where(inArray(sessions.id, ids)))
            .map((row) => [row.id, row.title]),
        )
      : new Map<string, string>();

    return NextResponse.json({
      events: rows.map((row) => ({
        id: row.id,
        action: row.action,
        actor: row.actor,
        session_id: row.sessionId,
        session_title: row.sessionId ? (titles.get(row.sessionId) ?? null) : null,
        topic_id: row.topicId,
        details: row.details ?? {},
        created_at: row.createdAt,
      })),
      limit,
    });
  } catch (error) {
    logError({
      consequence: 'Unable to read the activity log',
      moduleProcess: 'admin diagnostics / event query',
      cause: 'token verification or the event query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to read the activity log: admin diagnostics / event query - internal error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
