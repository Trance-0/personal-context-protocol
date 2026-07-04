import { NextResponse, NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages } from '@/lib/schema';
import { appendMessagesToSession, recordCompaction } from '@/lib/recording-store';
import { appendMessagesSchema, createCompactSchema } from '@/lib/validations';
import { parseIngestPayload } from '@/lib/ingest';
import { dedupeNewMessages } from '@/lib/import-merge';
import { agentErrorBody, mapAuthFailure } from '@/lib/agent-errors';
import { logError } from '@/lib/logging';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Forgiving agent ingestion: `POST /api/v1/agent/sessions/<id>/ingest`. Accepts
 * raw JSON `{ messages }` or `{ summary }`, `<PCP_INGEST>`/`<PCP_COMPACT>`/legacy
 * `<PCP_APPEND>` blocks, ChatML-like arrays, or transcript text, and normalizes
 * into messages and/or a compaction. Already-recorded messages are skipped.
 * On failure it returns structured retry guidance, not a vague error.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authResult = await verifySessionToken(request, params.id);
    if ('error' in authResult) {
      const { status, body } = mapAuthFailure(authResult);
      return NextResponse.json(body, { status });
    }

    const rawBody = await request.text().catch(() => '');
    const parsed = parseIngestPayload(rawBody);

    if (parsed.kind === 'error') {
      const { status, body } = agentErrorBody('UNPARSEABLE_PAYLOAD', { message: undefined });
      return NextResponse.json({ ...body, reason: parsed.reason }, { status });
    }

    const actor = `ai:${authResult.tokenId}`;
    let compactionsImported = 0;

    // Record a compaction when present (compact-only or mixed).
    if (parsed.kind === 'compact' || parsed.kind === 'mixed') {
      const validation = createCompactSchema.safeParse(parsed.compact);
      if (!validation.success) {
        const { status, body } = agentErrorBody('VALIDATION_ERROR');
        return NextResponse.json({ ...body, details: validation.error.errors }, { status });
      }
      const stored = await recordCompaction({ sessionId: params.id, compact: parsed.compact, actor });
      if (!stored.ok) {
        const { status, body } = agentErrorBody(stored.code);
        return NextResponse.json(body, { status });
      }
      compactionsImported = 1;
    }

    // Append message rows not already present (compact-only has none).
    const incoming = parsed.kind === 'mixed' || parsed.kind === 'messages' ? parsed.messages : [];
    let messagesImported = 0;
    let duplicatesSkipped = 0;

    if (incoming.length > 0) {
      const existing = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.sessionId, params.id));
      const deduped = dedupeNewMessages(incoming, existing);
      duplicatesSkipped = deduped.skipped;

      if (deduped.fresh.length > 0) {
        const validation = appendMessagesSchema.safeParse({ messages: deduped.fresh });
        if (!validation.success) {
          const { status, body } = agentErrorBody('VALIDATION_ERROR', {
            next_steps: ['Keep each message under max_content_chars and send at most max_messages_per_request per call.'],
          });
          return NextResponse.json({ ...body, details: validation.error.errors }, { status });
        }
        const result = await appendMessagesToSession({
          sessionId: params.id,
          messages: validation.data.messages,
          canRenameSession: authResult.canRenameSession,
          actor,
        });
        if (!result.ok) {
          const { status, body } = agentErrorBody(result.code);
          return NextResponse.json(body, { status });
        }
        messagesImported = result.messages.length;
      }
    }

    const events = (messagesImported > 0 ? 1 : 0) + compactionsImported;
    const notice = compactionsImported > 0 && messagesImported === 0
      ? 'Imported a compact summary. No raw messages were included.'
      : messagesImported === 0 && incoming.length > 0
        ? 'Everything in the payload was already recorded.'
        : 'Imported message-level content.';

    return NextResponse.json({
      ok: true,
      session_id: params.id,
      imported: { messages: messagesImported, compactions: compactionsImported, events, duplicates_skipped: duplicatesSkipped },
      notice,
    });
  } catch (error) {
    logError({
      consequence: 'Unable to ingest content',
      moduleProcess: 'agent session recording / forgiving ingest request',
      cause: 'token verification, payload parsing, or persistence failed',
      error,
    });
    const { status, body } = agentErrorBody('INTERNAL_ERROR');
    return NextResponse.json(body, { status });
  }
}
