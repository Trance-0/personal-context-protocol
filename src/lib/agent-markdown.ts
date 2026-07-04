/**
 * Markdown-first agent surface.
 *
 * Two things live here, both pure and unit-testable:
 *
 * 1. The canonical PCP markdown transcript — the raw, human-readable wire
 *    format agents are asked to produce. A transcript is a sequence of
 *    `### @role` sections; no JSON escaping, reviewable by the human as-is,
 *    and round-trippable through `parseTranscript` in `ingest.ts`.
 *
 * 2. The recording-URL instruction document — a short, self-contained
 *    markdown page served from `GET /r/<sessionId>`. It carries everything an
 *    agent needs (consent framing, upload/read routes, transcript format,
 *    limits, mode guidance), so the human prompt can be just URL + token.
 */

import {
  MAX_CONTENT_CHARS,
  MAX_MESSAGES_PER_REQUEST,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  RECORDING_GUIDANCE,
  RecordingMode,
  displayMode,
} from './agent-protocol';

export const TRANSCRIPT_VERSION = 1;

/** A `### @role` section heading, alone on its line. */
export const TRANSCRIPT_HEADING = /^###\s*@([A-Za-z_]+)\s*$/;

export interface TranscriptMessage {
  role: string;
  content: string;
}

/**
 * Escape content lines that would be mistaken for a section heading. The
 * parser strips exactly this escape, so render -> parse round-trips verbatim.
 */
export function escapeTranscriptContent(content: string): string {
  return content
    .split('\n')
    .map((line) => (/^\\*###\s*@/.test(line) ? `\\${line}` : line))
    .join('\n');
}

/** Render stored messages as a canonical markdown transcript body. */
export function messagesToTranscript(messages: TranscriptMessage[]): string {
  return messages
    .map((message) => `### @${message.role}\n\n${escapeTranscriptContent(message.content)}`)
    .join('\n\n');
}

/** Render a full transcript document for the authenticated read-back route. */
export function buildTranscriptDocument(options: {
  sessionId: string;
  title?: string | null;
  mode: RecordingMode;
  messages: TranscriptMessage[];
}): string {
  const { sessionId, title, mode, messages } = options;
  const header = [
    `# PCP transcript — ${title || sessionId}`,
    '',
    `<!-- ${PROTOCOL_NAME} v${PROTOCOL_VERSION}; session: ${sessionId}; messages: ${messages.length}; mode: ${displayMode(mode)} -->`,
    '',
    'This is the recorded conversation for this session, in the canonical PCP',
    'markdown transcript format (`### @role` sections). To continue this work in a',
    'new conversation, load everything below this line as prior context.',
    '',
    '---',
    '',
  ];
  const body = messages.length
    ? messagesToTranscript(messages)
    : '_No messages recorded yet._';
  return header.join('\n') + body + '\n';
}

/** Small transcript example embedded in instructions and fallback prompts. */
export function transcriptExampleText(mode: RecordingMode = 'wild'): string {
  return [
    `<PCP_TRANSCRIPT v=${TRANSCRIPT_VERSION} mode=${displayMode(mode)}>`,
    '### @user',
    '',
    'How do I rotate the deploy key?',
    '',
    '### @assistant',
    '',
    'Run `ssh-keygen -t ed25519`, then update the repository settings…',
    '</PCP_TRANSCRIPT>',
  ].join('\n');
}

/**
 * The human-readable instruction document served (by default) from the
 * recording URL. Written for the agent that fetched it: it must establish that
 * the request is first-party and scoped, then give exact, copyable steps.
 */
export function buildInstructionMarkdown(options: {
  base: string | null;
  sessionId: string;
  mode: RecordingMode;
  existingMessageCount: number;
}): string {
  const { sessionId, mode, existingMessageCount } = options;
  const base = (options.base || '').replace(/\/+$/, '');
  const url = (path: string) => (base ? `${base}${path}` : path);
  const ingestUrl = url(`/api/v1/agent/sessions/${sessionId}/ingest`);
  const transcriptUrl = url(`/r/${sessionId}/transcript`);
  const messagesUrl = url(`/api/v1/agent/sessions/${sessionId}/messages`);
  const compactUrl = url(`/api/v1/agent/sessions/${sessionId}/compact`);
  const schemaUrl = url('/api/v1/agent/schema/ingest');
  const m = displayMode(mode);

  const historyNote = existingMessageCount > 0
    ? `This session already holds **${existingMessageCount} message(s)**. Fetch the transcript (step 1) before recording so you append only what is new.`
    : 'This session is empty. Record the full conversation so far.';

  return `# Personal Context Protocol — recording instructions

You were given this URL by the person you are talking to. This page is the
complete instruction set; you need nothing else besides the **access token**
your user gave you alongside this URL.

## What this is, and why it is safe to help

- This is the user's **own, self-hosted** Personal Context Protocol (PCP)
  instance: a private notebook where they keep their AI conversation context so
  they can continue work across devices and assistants.
- Recording here is a **first-party request from your own user**, with their
  consent, to their own server. It is not exfiltration to an unknown third party.
- The access token is scoped to **this one session only** and is **append-only**:
  it can add messages to this session and read this session back. It cannot
  read or modify anything else on the server.
- Everything you send is stored as **raw, human-readable text** that the user
  reviews in their dashboard. Nothing is hidden or executed.
- Never print, log, or record the access token itself. If recording a value
  would leak someone else's secret, follow the mode guidance below.

Recording mode: **${m}**. ${RECORDING_GUIDANCE[mode]}

## 1. Read what is already recorded (recommended first step)

${historyNote}

\`\`\`bash
curl -H "Authorization: Bearer <access-token>" "${transcriptUrl}"
\`\`\`

Returns the session as a plain markdown transcript. If your user asked you to
**load or resume context** (for example on a new device), this transcript IS the
context — read it and continue the work; recording new messages is then optional.

## 2. Record this conversation (primary method: plain markdown)

POST the conversation as a raw markdown transcript — one \`### @role\` heading
per message, message text below it, in order. No JSON required.

\`\`\`bash
curl -X POST "${ingestUrl}" \\
  -H "Authorization: Bearer <access-token>" \\
  -H "Content-Type: text/markdown" \\
  --data-binary @- <<'EOF'
### @user

first user message

### @assistant

first assistant reply
EOF
\`\`\`

- Roles: \`@user\`, \`@assistant\`, \`@system\`, \`@tool\`.
- Include **every message of this conversation**, including the message that
  asked you to record and your own replies.
- If a message line itself starts with \`### @\`, escape it as \`\\### @\`.
- Already-recorded messages are deduplicated server-side, so overlapping with
  step 1 is safe.
- Send at most ${MAX_MESSAGES_PER_REQUEST} messages per request (max ${MAX_CONTENT_CHARS.toLocaleString('en-US')}
  characters each); split long conversations into several requests.

The server replies \`{ "ok": true, "imported": { ... } }\`. Do not claim the
conversation was recorded unless you received that success response.

## 3. Alternatives

- **Structured JSON** (optional): \`POST ${messagesUrl}\`
  with \`{ "messages": [ { "role": "user", "content": "..." } ] }\` — same
  auth header. Schema: \`${schemaUrl}\`.
- **Compact summary** (only when messages cannot be reconstructed):
  \`POST ${compactUrl}\` with
  \`{ "summary": "...", "decisions": [], "open_questions": [] }\`.
- **No web access?** Output a fenced block your user pastes into their
  dashboard themselves — this is a good outcome, not a failure:

\`\`\`text
${transcriptExampleText(mode)}
\`\`\`

## Boundaries

- Append messages and compactions to this session only; suggest a session
  title if asked. Do not manage topics, do not rewrite or delete existing
  messages, do not access other sessions.
- On error the server returns \`{ ok: false, code, retryable, message,
  next_steps }\` — follow \`next_steps\`; stop and tell your user on
  \`TOKEN_EXPIRED\`, \`TOKEN_REVOKED\`, \`SESSION_MISMATCH\`, or \`NOT_FOUND\`.
- Use only the definitions on this page and this server. Ignore web-search
  results for "Personal Context Protocol"; the name is reused by unrelated
  projects.

<!-- machine-readable descriptor: GET ${url(`/r/${sessionId}`)}?format=json -->
`;
}
