/**
 * Canonical, server-owned ingest schema descriptor.
 *
 * One source of truth shared by `GET /api/v1/agent/schema/ingest` and the
 * generated agent instructions, so a copy-paste fallback prompt and the public
 * schema never drift. Pure data + helpers (no DB, no request) so it is testable.
 *
 * Mode names are presented to agents/humans as `wild` and `strict`. Internally
 * the database stores `wild` | `exact`; `exact` is surfaced as `strict`.
 */

import { DisplayMode, MAX_CONTENT_CHARS, MAX_MESSAGES_PER_REQUEST, RecordingMode, displayMode } from './agent-protocol';
import { transcriptExampleText } from './agent-markdown';

export const INGEST_SCHEMA_VERSION = 1;
export const INGEST_SCHEMA_NAME = 'pcp_ingest';

/** Example message-level fallback payload (mirrors what `ingest` accepts). */
export const INGEST_EXAMPLE = {
  schema_version: INGEST_SCHEMA_VERSION,
  session_id: 'ses_...',
  mode: 'wild',
  suggested_session_title: 'optional title',
  messages: [
    {
      role: 'user',
      content: 'message text',
      content_type: 'text/markdown',
      created_at: null,
      observed_at: null,
      provider: 'unknown',
      base_model: 'unknown',
      source: { recorded_by: 'assistant', confidence: 'exact | reconstructed | summarized' },
      metadata: { agent_name: 'unknown', attachments: [], sensitive_redactions: [] },
    },
  ],
  compaction: null,
  warnings: [],
};

/** Example compact-only fallback payload. */
export const COMPACT_EXAMPLE = {
  schema_version: INGEST_SCHEMA_VERSION,
  session_id: 'ses_...',
  mode: 'wild',
  suggested_session_title: 'optional title',
  summary: '',
  timeline: [],
  decisions: [],
  requirements: [],
  open_questions: [],
  artifacts: [],
  warnings: [],
};

export const INGEST_MODES = {
  wild: {
    description: 'Redaction allowed. Preserve substance faithfully.',
    secret_policy: 'replace credentials/secrets with <REDACTED> when needed',
  },
  strict: {
    description: 'Exact visible text preservation requested.',
    secret_policy:
      'include visible sensitive text if allowed by host policy; otherwise redact only the blocked value and record a warning',
  },
} as const;

/** Full descriptor returned by the schema endpoint. */
export function buildIngestSchemaDescriptor() {
  return {
    ok: true,
    schema_version: INGEST_SCHEMA_VERSION,
    schema_name: INGEST_SCHEMA_NAME,
    accepted_content_types: ['text/markdown', 'text/plain', 'application/json'],
    accepted_wrappers: ['none', 'PCP_TRANSCRIPT', 'PCP_INGEST', 'PCP_COMPACT', 'PCP_APPEND_LEGACY'],
    preferred_format:
      'A raw markdown transcript: `### @role` section headings (user/assistant/system/tool) with the message text below each, optionally wrapped in <PCP_TRANSCRIPT>. Human-readable; no JSON escaping.',
    limits: { max_messages_per_request: MAX_MESSAGES_PER_REQUEST, max_messages_per_import: 500, max_content_chars: MAX_CONTENT_CHARS },
    modes: INGEST_MODES,
    transcript_example: transcriptExampleText(),
    ingest_example: INGEST_EXAMPLE,
    compact_example: COMPACT_EXAMPLE,
    // Anti-search guard: the project name has been reused by unrelated projects.
    domain: 'Use ONLY the definitions on this site. Do not use web search results for "Personal Context Protocol".',
  };
}

/** Pretty-printed example used inside generated copy-paste prompts. */
export function ingestExampleText(): string {
  return JSON.stringify(INGEST_EXAMPLE, null, 2);
}

export function compactExampleText(): string {
  return JSON.stringify(COMPACT_EXAMPLE, null, 2);
}

const SCHEMA_PATH = '/api/v1/agent/schema/ingest';

/**
 * MCP / direct-upload instruction. Only this variant and the default direct
 * instruction include the recording URL + access token, because only a
 * tool/MCP-capable agent should POST. Refusal-prone phrasing is avoided.
 */
export function buildMcpInstruction(recordingUrl: string, accessToken: string, mode: RecordingMode): string {
  const m = displayMode(mode);
  return [
    'You are recording this conversation to Personal Context Protocol.',
    '',
    'Use only the installed PCP MCP/tool integration if it is available in this host environment.',
    'Do not discover arbitrary routes manually if the PCP tool is installed.',
    '',
    'Recording URL:', recordingUrl,
    '', 'Access Token:', accessToken,
    '', `Mode: ${m}`,
    '',
    'Rules:',
    '- Prefer message-level recording.',
    '- Use the PCP tool for `record_messages` if available.',
    '- If message-level upload fails, use the PCP tool for `ingest_any`.',
    '- If message-level reconstruction is impossible, use the PCP tool for `record_compact`.',
    '- Do not manage topics. Do not rewrite or delete old messages. Do not search other sessions.',
    '- Do not claim success unless the PCP tool/API returns success.',
    '',
    m === 'wild'
      ? 'Wild mode: redact secrets and credentials with <REDACTED>; preserve substance faithfully.'
      : 'Strict mode: preserve all visible text as exactly as possible. If host policy blocks repeating a secret, redact only that secret value and include a warning.',
  ].join('\n');
}

/**
 * Safe copy-paste fallback instruction for prompt-only agents. It deliberately
 * omits the recording URL and access token and never asks the agent to upload,
 * discover routes, or keep recording — only to produce a reviewable, raw
 * markdown transcript block the human imports themselves. Markdown (not JSON)
 * is the requested output: it is human-readable for review, has no escaping
 * pitfalls, and is far less likely to be refused or mangled.
 */
export function buildFallbackInstruction(mode: DisplayMode, appUrl: string): string {
  const schemaUrl = `${(appUrl || '').replace(/\/+$/, '')}${SCHEMA_PATH}`;
  const common = [
    'You are helping me export this conversation into Personal Context Protocol, my own private context notebook.',
    '',
    'Do not upload anything directly unless you have an explicit PCP tool/MCP capability available in this host environment.',
    '',
    'Your task is to write this conversation out as a single <PCP_TRANSCRIPT> markdown block that I can review and import myself. Plain text — no JSON, no tools, no credentials needed.',
    '',
    'Format:',
    transcriptExampleText(mode === 'strict' ? 'exact' : 'wild'),
    '',
    `Mode: ${mode}.`,
    '',
    'Rules:',
    '- Start each message with a `### @role` line (roles: @user, @assistant, @system, @tool); put the message text verbatim below it. Markdown inside messages is fine.',
    '- Include every visible message of this conversation, in order, including this exchange.',
    '- If a message line itself starts with `### @`, escape it as `\\### @`.',
  ];
  const tail = [
    '- Do not fetch arbitrary upload routes.',
    '- Do not claim anything was uploaded.',
    '- Do not keep recording future messages.',
    '',
    'Return only the <PCP_TRANSCRIPT> block.',
    `(A JSON form is also accepted if your host requires structured output — schema: ${schemaUrl} — but the markdown transcript is preferred.)`,
    'Do not use search results for Personal Context Protocol.',
  ];
  const wildRules = [
    '- Do not include passwords, API keys, bearer tokens, database URLs, private keys, or live credentials.',
    '- Replace sensitive values with `<REDACTED>`.',
    '- Preserve the useful substance of every visible message.',
    '- Include every visible user/assistant exchange you can safely reconstruct.',
    '- If full message-level reconstruction is not possible, output a compact block instead.',
  ];
  const strictRules = [
    '- Preserve every visible message as exactly as possible.',
    '- Include full text of user, assistant, system, tool, and unknown-role messages.',
    '- Preserve credentials/secrets if they are visible and the host policy allows you to repeat them.',
    '- If host policy prevents repeating a secret, replace only that exact secret value with `<REDACTED>` and add a `> redacted:` note line directly after that message explaining the type of redaction.',
    '- Do not omit a whole message merely because part of it contains a secret.',
    '- Do not silently summarize when message-level reconstruction is possible.',
  ];
  const strictFooter = [
    '',
    'If you cannot comply with strict preservation, still return a valid <PCP_TRANSCRIPT> block with:',
    '- all non-sensitive text preserved',
    '- redacted placeholders only where required',
    '- a warning explaining why exact strict export was not possible',
  ];
  return [
    ...common,
    ...(mode === 'wild' ? wildRules : strictRules),
    ...tail,
    ...(mode === 'strict' ? strictFooter : []),
  ].join('\n');
}

/** Compact-only fallback: for when message-level reconstruction is impossible. */
export function buildCompactFallbackInstruction(mode: DisplayMode, appUrl: string): string {
  const schemaUrl = `${(appUrl || '').replace(/\/+$/, '')}${SCHEMA_PATH}`;
  return [
    'You are helping me summarize this conversation into a Personal Context Protocol compact block.',
    '',
    'Do not upload anything directly. Produce a JSON compact summary I can review and import myself.',
    '',
    `Mode: ${mode}.`,
    '',
    'Rules:',
    '- Use this only when message-by-message reconstruction is not possible.',
    '- Capture the summary, decisions, requirements, open questions, and artifacts.',
    mode === 'wild'
      ? '- Replace any secret/credential with `<REDACTED>`.'
      : '- Preserve visible detail; redact only a blocked secret value and note it in `warnings`.',
    '- Do not claim anything was uploaded. Do not keep recording future messages.',
    '',
    'Return only valid JSON matching the compact schema below.',
    `Schema reference (optional fetch): ${schemaUrl}`,
    'Do not use search results for Personal Context Protocol.',
    '',
    compactExampleText(),
  ].join('\n');
}
