import { z } from 'zod';
import { MAX_CONTENT_CHARS, MAX_MESSAGES_PER_REQUEST } from './agent-protocol';
import { EXPIRATION_CHOICES } from './token-expiration';

// Message schemas
export const messageInputSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool', 'correction']),
  content: z.string().min(1).max(MAX_CONTENT_CHARS),
  provider: z.string().max(100).optional(),
  base_model: z.string().max(100).optional(),
  provider_timestamp: z.string().datetime().optional(),
});

export const appendMessagesSchema = z.object({
  messages: z.array(messageInputSchema).min(1).max(MAX_MESSAGES_PER_REQUEST),
  suggested_session_title: z.string().max(200).optional(),
});

// Compaction schema (agent compact + ingest routes)
export const createCompactSchema = z.object({
  summary: z.string().min(1).max(MAX_CONTENT_CHARS),
  timeline: z.unknown().optional(),
  decisions: z.unknown().optional(),
  requirements: z.unknown().optional(),
  open_questions: z.unknown().optional(),
  artifacts: z.unknown().optional(),
  warnings: z.unknown().optional(),
  provider: z.string().max(100).optional(),
  base_model: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Topic schemas. Titles are free-text and optional: a human can click
// "New Topic" without typing, and the server auto-generates/auto-suffixes.
export const createTopicSchema = z.object({
  title: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
});

export const renameTopicSchema = z.object({
  title: z.string().min(1).max(100),
});

// Session schemas. `topic_id` is optional: omit it for an uncategorized session.
export const createSessionSchema = z.object({
  title: z.string().max(200).optional(),
  topic_id: z.string().min(1).optional(),
  mode: z.enum(['wild', 'exact']).optional(),
});

export const renameSessionSchema = z.object({
  title: z.string().min(1).max(200),
});

export const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  // null moves the session to "no topic" (uncategorized).
  topic_id: z.string().min(1).nullable().optional(),
  archived: z.boolean().optional(),
  public: z.boolean().optional(),
  mode: z.enum(['wild', 'exact']).optional(),
}).refine((value) => (
  value.title !== undefined
  || value.topic_id !== undefined
  || value.archived !== undefined
  || value.public !== undefined
  || value.mode !== undefined
), 'At least one session field is required');

// Admin message correction (human only — AI tokens remain append-only).
export const editMessageSchema = z.object({
  content: z.string().min(1).max(MAX_CONTENT_CHARS),
});

export const deleteMessagesSchema = z.object({
  message_ids: z.array(z.string().min(1)).min(1).max(1000),
});

// Token management: rename and/or revoke an issued token.
export const manageTokenSchema = z.object({
  token_id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  revoke: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.revoke === true,
  'Provide a new name or revoke: true');

// Token schemas. `name` is optional (server defaults it) and `expires_in`
// chooses the lifetime; default is 7 days, "never" stores a NULL expiry.
// `can_rename_session` defaults to true so a recording agent can title the
// session to fit the conversation; the human can always rename afterwards.
export const createTokenSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  can_rename_session: z.boolean().optional().default(true),
  expires_in: z.enum(EXPIRATION_CHOICES).optional(),
});

// Setup schemas
export const unlockSchema = z.object({
  ui_token: z.string().min(1),
});

// Error response schema
export const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.record(z.unknown()).optional(),
});

// Success response schema
export const successResponseSchema = z.object({
  success: z.literal(true),
});
