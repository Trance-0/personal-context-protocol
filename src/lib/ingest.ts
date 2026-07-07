/**
 * Forgiving ingestion parser for the agent `ingest_any` route.
 *
 * Accepts whatever an AI agent can most easily produce and normalizes it into
 * either append-able messages or a compaction record:
 *
 *   - raw markdown transcript with `### @role` section headings (canonical)
 *   - <PCP_TRANSCRIPT> ... </PCP_TRANSCRIPT>  (markdown transcript block)
 *   - { "messages": [ ... ] }
 *   - <PCP_APPEND> ... </PCP_APPEND>     (JSON: array or { messages })
 *   - <PCP_COMPACT> ... </PCP_COMPACT>   (JSON object, or plain summary text)
 *   - simple ChatML-like arrays:  [ { role, content }, ... ]
 *   - loose "User: ...\nAssistant: ..." transcript lines
 *
 * Pure and self-contained so it can be unit-tested. Returns a discriminated
 * result; the route turns `{ kind: 'error' }` into structured retry guidance.
 */

import { MAX_CONTENT_CHARS, MAX_MESSAGES_PER_REQUEST } from './agent-protocol';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'correction';

export interface NormalizedMessage {
  role: MessageRole;
  content: string;
  provider?: string;
  base_model?: string;
}

export interface NormalizedCompact {
  summary: string;
  timeline?: unknown;
  decisions?: unknown;
  requirements?: unknown;
  open_questions?: unknown;
  artifacts?: unknown;
  warnings?: unknown;
  provider?: string;
  base_model?: string;
  metadata?: Record<string, unknown>;
}

export type IngestResult =
  | { kind: 'messages'; messages: NormalizedMessage[]; suggestedTitle?: string }
  | { kind: 'compact'; compact: NormalizedCompact; suggestedTitle?: string }
  | { kind: 'mixed'; messages: NormalizedMessage[]; compact: NormalizedCompact; suggestedTitle?: string }
  | { kind: 'error'; reason: string };

const ROLE_LINE = /^\s*(user|assistant|system|tool|human|ai|bot|function|correction)\s*:\s*/i;

/** Map a free-text or ChatML role onto a stored message role. */
export function normalizeRole(raw: unknown): MessageRole {
  const value = String(raw || '').trim().toLowerCase();
  switch (value) {
    case 'assistant':
    case 'ai':
    case 'bot':
    case 'model':
      return 'assistant';
    case 'system':
    case 'developer':
      return 'system';
    case 'tool':
    case 'function':
      return 'tool';
    case 'correction':
      return 'correction';
    case 'user':
    case 'human':
    default:
      return 'user';
  }
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

/** Coerce an array or { messages } object into normalized messages. */
function coerceMessages(value: unknown): NormalizedMessage[] | null {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { messages?: unknown }).messages)
      ? (value as { messages: unknown[] }).messages
      : null;

  if (!list) return null;

  const messages: NormalizedMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      const content = asString(item);
      if (content.trim()) messages.push({ role: 'user', content });
      continue;
    }
    const record = item as Record<string, unknown>;
    const content = asString(record.content ?? record.text ?? record.message);
    if (!content.trim()) continue;
    const message: NormalizedMessage = { role: normalizeRole(record.role), content };
    if (typeof record.provider === 'string') message.provider = record.provider;
    const baseModel = record.base_model ?? record.model;
    if (typeof baseModel === 'string') message.base_model = baseModel;
    messages.push(message);
  }

  return messages.length ? messages : null;
}

const COMPACT_KEYS = [
  'summary',
  'timeline',
  'decisions',
  'requirements',
  'open_questions',
  'artifacts',
  'warnings',
] as const;

function looksLikeCompact(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return COMPACT_KEYS.some((key) => key in record);
}

/** Coerce a value into a normalized compaction record. */
function coerceCompact(value: unknown): NormalizedCompact | null {
  if (typeof value === 'string') {
    const summary = value.trim();
    return summary ? { summary } : null;
  }
  if (!looksLikeCompact(value)) return null;
  const record = value as Record<string, unknown>;
  const summary = asString(record.summary).trim();
  const compact: NormalizedCompact = { summary };
  if (record.timeline !== undefined) compact.timeline = record.timeline;
  if (record.decisions !== undefined) compact.decisions = record.decisions;
  if (record.requirements !== undefined) compact.requirements = record.requirements;
  if (record.open_questions !== undefined) compact.open_questions = record.open_questions;
  if (record.artifacts !== undefined) compact.artifacts = record.artifacts;
  if (record.warnings !== undefined) compact.warnings = record.warnings;
  if (typeof record.provider === 'string') compact.provider = record.provider;
  const baseModel = record.base_model ?? record.model;
  if (typeof baseModel === 'string') compact.base_model = baseModel;
  return compact;
}

/**
 * Coerce a JSON value that may carry messages and/or a compaction into a single
 * result. A nested `compaction` field wins; otherwise the whole object is treated
 * as a compaction only when there are no messages (so a plain `{ messages }`
 * with a stray `summary` is not misread as mixed).
 */
/**
 * Pull an agent-suggested session title from a JSON payload. Accepts the
 * canonical `suggested_session_title` and the shorter `session_title` alias.
 * Ignores the schema placeholder ("optional title" / "ses_...").
 */
function pickSuggestedTitle(record: Record<string, unknown>): string | undefined {
  const raw = record.suggested_session_title ?? record.session_title;
  if (typeof raw !== 'string') return undefined;
  const title = raw.trim();
  if (!title || /^optional\b/i.test(title)) return undefined;
  return title;
}

function coerceCombined(value: unknown, limit: number): IngestResult | null {
  if (value === undefined || value === null) return null;
  const messages = coerceMessages(value);
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const suggestedTitle = pickSuggestedTitle(record);

  let compact: NormalizedCompact | null = null;
  if (record.compaction !== undefined && record.compaction !== null) {
    compact = coerceCompact(record.compaction);
  } else if (!messages) {
    compact = coerceCompact(value);
  }

  const sliced = messages ? messages.slice(0, limit) : null;
  if (sliced && compact && compact.summary) return { kind: 'mixed', messages: sliced, compact, suggestedTitle };
  if (sliced) return { kind: 'messages', messages: sliced, suggestedTitle };
  if (compact && compact.summary) return { kind: 'compact', compact, suggestedTitle };
  return null;
}

/** Canonical transcript heading: `### @role` alone on its line. */
const TRANSCRIPT_HEADING = /^###\s*@([A-Za-z_]+)\s*$/;

/** Strip the heading escape produced by the transcript renderer (`\### @` -> `### @`). */
function unescapeTranscriptLine(line: string): string {
  return /^\\+###\s*@/.test(line) ? line.slice(1) : line;
}

/**
 * Parse the canonical markdown transcript: `### @role` section headings with
 * the message text below each. Prose before the first heading (e.g. "Here is
 * the transcript:") is ignored. Returns null when no heading is present.
 */
function parseHeadingTranscript(text: string): NormalizedMessage[] | null {
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => TRANSCRIPT_HEADING.test(line))) return null;

  const messages: NormalizedMessage[] = [];
  let current: { role: MessageRole; lines: string[] } | null = null;
  for (const line of lines) {
    const match = line.match(TRANSCRIPT_HEADING);
    if (match) {
      if (current) {
        const content = current.lines.join('\n').trim();
        if (content) messages.push({ role: current.role, content });
      }
      current = { role: normalizeRole(match[1]), lines: [] };
    } else if (current) {
      current.lines.push(unescapeTranscriptLine(line));
    }
  }
  if (current) {
    const content = current.lines.join('\n').trim();
    if (content) messages.push({ role: current.role, content });
  }
  return messages.length ? messages : null;
}

/**
 * Best-effort transcript parse. Canonical `### @role` headings win when
 * present; otherwise split on loose `Role:` line markers.
 */
export function parseTranscript(text: string): NormalizedMessage[] {
  const headingMessages = parseHeadingTranscript(text);
  if (headingMessages) return headingMessages;

  const lines = text.split(/\r?\n/);
  const messages: NormalizedMessage[] = [];
  let current: NormalizedMessage | null = null;

  for (const line of lines) {
    const match = line.match(ROLE_LINE);
    if (match) {
      if (current && current.content.trim()) messages.push(current);
      current = { role: normalizeRole(match[1]), content: line.slice(match[0].length) };
    } else if (current) {
      current.content += `\n${line}`;
    } else if (line.trim()) {
      current = { role: 'user', content: line };
    }
  }
  if (current && current.content.trim()) messages.push(current);

  return messages.map((message) => ({ ...message, content: message.content.trim() }));
}

/** Extract a `<TAG>`/`<TAG attr…>` block body; tolerates attributes in the open tag. */
function extractTag(text: string, tag: string): string | null {
  const open = text.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`));
  if (!open || open.index === undefined) return null;
  const close = `</${tag}>`;
  const start = open.index + open[0].length;
  const end = text.indexOf(close, start);
  if (end === -1) return null;
  return text.slice(start, end).trim();
}

/** Read a `title="..."` (or `title='...'`) attribute from a tag's open form. */
function extractTagTitle(text: string, tag: string): string | undefined {
  const open = text.match(new RegExp(`<${tag}(\\s[^>]*)?>`));
  if (!open) return undefined;
  const attrs = open[1] || '';
  const attr = attrs.match(/\btitle\s*=\s*("([^"]*)"|'([^']*)')/);
  const title = (attr?.[2] ?? attr?.[3] ?? '').trim();
  return title || undefined;
}

function tryJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Extract the first complete JSON object or array found anywhere in `text`.
 * Handles the common case where an agent pastes its entire response including
 * prose like "Here is the fallback block:" before the actual JSON payload.
 * Also strips trailing commas / minor formatting issues for robustness.
 * Returns the parsed value and the cleaned JSON substring that was consumed.
 */
function extractFirstJson(text: string): { value: unknown; consumed: string } | null {
  // Find the first JSON opening character.
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let start = -1;
  let closer: (c: string) => string = () => '';
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) { start = firstBrace; closer = () => '}'; }
  else if (firstBracket !== -1) { start = firstBracket; closer = () => ']'; }
  if (start === -1) return null;

  // Walk characters tracking depth until we find the matching close.
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { depth++; }
    else if (ch === '}' || ch === ']') { depth--; }
    if (depth === 0) { end = i + 1; break; }
  }
  if (end === -1) return null;

  const jsonSubstring = text.slice(start, end);
  // Try parsing. If it fails due to trailing commas, try to clean up.
  let value = tryJson(jsonSubstring);
  if (value === undefined) {
    // Common fix: trailing commas in objects/arrays.
    const cleaned = jsonSubstring.replace(/,(\s*[}\]])/g, '$1');
    value = tryJson(cleaned);
  }
  if (value === undefined) return null;
  return { value, consumed: jsonSubstring };
}

/**
 * Parse a raw request body (already read as text) into a normalized ingest
 * result. The order matters: explicit PCP tags first, then any JSON found
 * anywhere in the text (backward-compatible with older formats and raw agent
 * responses), then a best-effort transcript fallback. Vacuously empty input
 * is the only error.
 */
export function parseIngestPayload(
  rawBody: string,
  options: { maxMessages?: number } = {},
): IngestResult {
  const limit = options.maxMessages ?? MAX_MESSAGES_PER_REQUEST;
  const text = (rawBody || '').trim();
  if (!text) {
    return { kind: 'error', reason: 'empty request body' };
  }

  // 0. Canonical markdown transcript block (raw, human-readable format). An
  // optional `title="..."` attribute on the open tag becomes the suggested
  // session title.
  const transcriptTag = extractTag(text, 'PCP_TRANSCRIPT');
  if (transcriptTag !== null) {
    const transcriptMessages = parseTranscript(transcriptTag);
    if (transcriptMessages.length) {
      return { kind: 'messages', messages: transcriptMessages.slice(0, limit), suggestedTitle: extractTagTitle(text, 'PCP_TRANSCRIPT') };
    }
    return { kind: 'error', reason: 'PCP_TRANSCRIPT block contained no messages' };
  }

  // 0b. Unclosed PCP_TRANSCRIPT tag (agent forgot </PCP_TRANSCRIPT>).
  const partialTranscript = text.match(/<PCP_TRANSCRIPT(?:\s[^>]*)?>/);
  if (partialTranscript && partialTranscript.index !== undefined) {
    const rest = text.slice(partialTranscript.index + partialTranscript[0].length).trim();
    const transcriptMessages = parseTranscript(rest);
    if (transcriptMessages.length) {
      return { kind: 'messages', messages: transcriptMessages.slice(0, limit), suggestedTitle: extractTagTitle(text, 'PCP_TRANSCRIPT') };
    }
  }

  // 1. Canonical combined block: messages and/or a nested compaction.
  const ingestTag = extractTag(text, 'PCP_INGEST');
  if (ingestTag !== null) {
    const result = coerceCombined(tryJson(ingestTag), limit);
    if (result) return result;
    return { kind: 'error', reason: 'PCP_INGEST block contained no messages or compaction' };
  }

  // 2. Explicit compact tag.
  const compactTag = extractTag(text, 'PCP_COMPACT');
  if (compactTag !== null) {
    const compact = coerceCompact(tryJson(compactTag) ?? compactTag);
    if (compact) return { kind: 'compact', compact };
    return { kind: 'error', reason: 'PCP_COMPACT block had no summary or recognizable fields' };
  }

  // 2b. Unclosed PCP_INGEST tag (agent forgot </PCP_INGEST>).
  const partialIngest = text.indexOf('<PCP_INGEST>');
  if (partialIngest !== -1) {
    const partial = text.slice(partialIngest + 12).trim();
    const json = extractFirstJson(partial) ?? { value: tryJson(partial), consumed: partial };
    if (json.value !== undefined) {
      const result = coerceCombined(json.value, limit);
      if (result) return result;
    }
  }

  // 3. Explicit append tag.
  const appendTag = extractTag(text, 'PCP_APPEND');
  if (appendTag !== null) {
    const messages = coerceMessages(tryJson(appendTag));
    if (messages) return { kind: 'messages', messages: messages.slice(0, limit) };
    const transcript = parseTranscript(appendTag);
    if (transcript.length) return { kind: 'messages', messages: transcript.slice(0, limit) };
    return { kind: 'error', reason: 'PCP_APPEND block contained no messages' };
  }

  // 4. Structured JSON at the start of the text.
  const json = tryJson(text);
  if (json !== undefined) {
    const combined = coerceCombined(json, limit);
    if (combined) return combined;
  }

  // 4b. Find the first complete JSON object/array ANYWHERE in the text.
  // This is backward-compatible: the human may paste the agent's ENTIRE
  // response including prose or instruction text before the JSON payload.
  const extracted = extractFirstJson(text);
  if (extracted !== null) {
    const combined = coerceCombined(extracted.value, limit);
    if (combined) return combined;
  }

  // 5. Raw transcript / markdown fallback.
  const transcript = parseTranscript(text);
  if (transcript.length) {
    return { kind: 'messages', messages: transcript.slice(0, limit) };
  }

  return { kind: 'error', reason: 'body did not match any supported format' };
}

export interface DryRunResult {
  valid: boolean;
  would_import?: { messages: number; compactions: number };
  warnings?: string[];
  code?: string;
  message?: string;
  next_steps?: string[];
}

const SCHEMA_HINT = 'Use GET /api/v1/agent/schema/ingest for the current schema.';

/**
 * Validate a fallback payload without storing anything. Returns the count it
 * would import, or a structured, actionable error. Pure so it is unit-testable
 * and reusable by the dry-run route.
 */
export function dryRunIngest(rawBody: string): DryRunResult {
  // Precise structural check: when a top-level `messages` array is present,
  // point at the first message that is missing usable content.
  const obj = (() => {
    const direct = tryJson((rawBody || '').trim());
    if (direct !== undefined) return direct;
    return extractFirstJson(rawBody || '')?.value;
  })();
  if (obj && typeof obj === 'object' && Array.isArray((obj as { messages?: unknown }).messages)) {
    const list = (obj as { messages: unknown[] }).messages;
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i] as { content?: unknown } | null;
      const content = item && typeof item === 'object' ? item.content : item;
      if (typeof content !== 'string' || !content.trim()) {
        return {
          valid: false,
          code: 'INVALID_INGEST_SCHEMA',
          message: `The payload is missing messages[${i}].content.`,
          next_steps: ['Add content to each message.', SCHEMA_HINT],
        };
      }
    }
  }

  const parsed = parseIngestPayload(rawBody, { maxMessages: 500 });
  if (parsed.kind === 'error') {
    return {
      valid: false,
      code: 'INVALID_INGEST_SCHEMA',
      message: `The payload could not be parsed as a PCP ingest fallback: ${parsed.reason}.`,
      next_steps: [
        'Send { "messages": [ { "role": "user", "content": "..." } ] } or wrap it in <PCP_INGEST>...</PCP_INGEST>.',
        SCHEMA_HINT,
      ],
    };
  }

  const messages = parsed.kind === 'messages' || parsed.kind === 'mixed' ? parsed.messages : [];
  const tooLong = messages.find((message) => message.content.length > MAX_CONTENT_CHARS);
  if (tooLong) {
    return {
      valid: false,
      code: 'INVALID_INGEST_SCHEMA',
      message: `A message exceeds the ${MAX_CONTENT_CHARS} character limit.`,
      next_steps: ['Split long messages into smaller ones.', SCHEMA_HINT],
    };
  }

  return {
    valid: true,
    would_import: { messages: messages.length, compactions: parsed.kind === 'compact' || parsed.kind === 'mixed' ? 1 : 0 },
    warnings: [],
  };
}
