import { NextResponse, NextRequest } from 'next/server';
import { buildDiscovery } from '@/lib/agent-discovery';
import { buildInstructionMarkdown } from '@/lib/agent-markdown';
import { resolveAppBaseUrl } from '@/lib/recording-url';
import { normalizeRecordingMode } from '@/lib/agent-protocol';
import { logError } from '@/lib/logging';
import { agentErrorBody } from '@/lib/agent-errors';

export const dynamic = 'force-dynamic';

/** True when the caller explicitly asked for the JSON protocol descriptor. */
function wantsJson(request: NextRequest): boolean {
  const format = request.nextUrl.searchParams.get('format');
  if (format === 'json') return true;
  if (format === 'md' || format === 'markdown') return false;
  const accept = request.headers.get('accept') || '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

/**
 * Public recording-URL entry point. By default it serves a self-contained,
 * human-readable markdown instruction document, so "fetch this URL" is the
 * only step a human has to give an agent besides the token. Clients that ask
 * for JSON (`?format=json` or `Accept: application/json`) get the structured
 * protocol descriptor instead.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  try {
    const { status, body } = await buildDiscovery(params.sessionId, request.nextUrl.origin);
    if (wantsJson(request)) {
      return NextResponse.json(body, { status });
    }
    if (status !== 200) {
      const message = 'message' in body && typeof body.message === 'string' ? body.message : 'Recording session not found.';
      return new NextResponse(`# Personal Context Protocol\n\n${message}\n`, {
        status,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      });
    }
    const discovery = body as Record<string, unknown>;
    const markdown = buildInstructionMarkdown({
      base: resolveAppBaseUrl(request.nextUrl.origin),
      sessionId: params.sessionId,
      mode: normalizeRecordingMode(discovery.recording_mode),
      existingMessageCount: typeof discovery.existing_message_count === 'number' ? discovery.existing_message_count : 0,
    });
    return new NextResponse(markdown, {
      status: 200,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  } catch (error) {
    logError({
      consequence: 'Unable to resolve recording URL',
      moduleProcess: 'agent protocol discovery / recording URL lookup',
      cause: 'session lookup or protocol construction failed',
      error,
    });
    const { status, body } = agentErrorBody('INTERNAL_ERROR');
    return NextResponse.json(body, { status });
  }
}
