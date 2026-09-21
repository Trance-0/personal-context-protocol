import { NextResponse, NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages, sessions } from '@/lib/schema';
import { buildTranscriptDocument } from '@/lib/agent-markdown';
import { normalizeRecordingMode } from '@/lib/agent-protocol';
import { logError } from '@/lib/logging';
import { agentErrorBody, mapAuthFailure } from '@/lib/agent-errors';
import { asc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Session read-back as a raw markdown transcript, authenticated with the
 * session access token. This is the cross-device sync pull: an agent on a new
 * device fetches this one URL with the token and receives the full recorded
 * conversation in the same human-readable format it records in.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  try {
    const authResult = await verifySessionToken(request, params.sessionId);
    if ('error' in authResult) {
      const { status, body } = mapAuthFailure(authResult);
      return NextResponse.json(body, { status });
    }

    const [session] = await db
      .select({ title: sessions.title, mode: sessions.mode })
      .from(sessions)
      .where(eq(sessions.id, params.sessionId));
    if (!session) {
      const { status, body } = agentErrorBody('NOT_FOUND');
      return NextResponse.json(body, { status });
    }

    const rows = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.sessionId, params.sessionId))
      .orderBy(asc(messages.ordinal));

    const markdown = buildTranscriptDocument({
      sessionId: params.sessionId,
      title: session.title,
      mode: normalizeRecordingMode(session.mode),
      messages: rows,
    });
    return new NextResponse(markdown, {
      status: 200,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  } catch (error) {
    logError({
      consequence: 'Unable to read the session transcript',
      moduleProcess: 'agent session recording / transcript read-back',
      cause: 'token verification or message query failed',
      error,
    });
    const { status, body } = agentErrorBody('INTERNAL_ERROR');
    return NextResponse.json(body, { status });
  }
}
