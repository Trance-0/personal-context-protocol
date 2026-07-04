/**
 * Anonymous protocol discovery for agent routes.
 *
 * The recording URL and protocol endpoint are public: they expose only
 * non-secret session information (the session id and the upload routes) so an
 * agent can learn where to POST before presenting its token. Writing still
 * requires the access token.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { messages, sessions } from './schema';
import { buildAgentProtocol, normalizeRecordingMode } from './agent-protocol';
import { buildRecordingUrl, resolveAppBaseUrl } from './recording-url';
import { agentErrorBody, type AgentErrorBody } from './agent-errors';

export async function buildDiscovery(
  sessionId: string,
  requestOrigin?: string | null,
): Promise<{ status: number; body: AgentErrorBody | Record<string, unknown> }> {
  const [session] = await db
    .select({ id: sessions.id, mode: sessions.mode })
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) {
    return agentErrorBody('NOT_FOUND');
  }

  const base = resolveAppBaseUrl(requestOrigin);
  const protocol = buildAgentProtocol(sessionId, { mode: normalizeRecordingMode(session.mode) });

  // Include the session's existing message count so the agent knows whether
  // it needs to read history and pick up from the next ordinal.
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(eq(messages.sessionId, sessionId));

  const existingCount = countRow ? countRow.count : 0;

  const recordingUrl = base ? buildRecordingUrl(base, sessionId) : null;
  return {
    status: 200,
    body: {
      ...protocol,
      recording_url: recordingUrl,
      instructions_url: recordingUrl ? `${recordingUrl}?format=md` : null,
      transcript_url: recordingUrl ? `${recordingUrl}/transcript` : null,
      preferred_upload_format:
        'Raw markdown transcript (`### @role` sections) posted to ingest_any with Content-Type: text/markdown. JSON is also accepted.',
      existing_message_count: existingCount,
      hint: existingCount > 0
        ? `This session has ${existingCount} message(s). Fetch read_transcript to review them, then continue recording from ordinal ${existingCount + 1}.`
        : 'This session has no messages yet. Record the full conversation history.',
    },
  };
}
