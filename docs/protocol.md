# API Reference

Base path: `/api/v1`

All protected endpoints use:

```http
Authorization: Bearer <token>
```

## Error Shape

```json
{
  "error": "Unable to append messages: AI session recording / append message transaction - session lookup failed",
  "code": "INTERNAL_ERROR"
}
```

Every error must include consequence, module/process, and cause.

## Public And Setup

### GET `/health`

Returns service status.

### GET `/setup/status`

Ensures the database schema exists when `DATABASE_URL` is configured, then returns whether the app has been initialized. In normal Vercel and Docker deployments this is already true because deploy initialization runs during build or container start.

### POST `/setup/init`

Fallback initializer for cases where deploy initialization did not run. It ensures the database schema exists, initializes the app, and returns the UI token once. If `PCP_ADMIN_TOKEN` is configured, setup stores that token hash and returns no plaintext token. If `PCP_ADMIN_TOKEN` is not configured, setup generates a temporary first-login token, returns it once, and prints it once in server logs so zero-config deployments can still log in. If the app is initialized but the `ui_auth` credential row is missing, setup creates and returns one replacement token.

Response:

```json
{
  "success": true,
  "initialized": true,
  "ui_token": "<shown once or null when PCP_ADMIN_TOKEN is configured>",
  "env_admin_token_configured": false,
  "message": "No PCP_ADMIN_TOKEN was configured, so PCP generated a first-login admin token. It is shown once here and printed once in deployment logs. Log in with it, then change it immediately in Settings so the real credential is never visible in logs."
}
```

### GET `/auth/check`

Validates a UI/admin bearer token before opening the dashboard. If `PCP_ADMIN_TOKEN` is configured, the deployment token is reconciled into `ui_auth` before validation. Missing generated credentials return `SETUP_REQUIRED`; configured-but-unusable deployment credentials return `INVALID_ADMIN_TOKEN` or `ADMIN_CREDENTIAL_NOT_INITIALIZED` with a deployment guide URL.

### PATCH `/auth/token`

Updates the UI/admin token after the caller authenticates with the current valid UI token. This endpoint is disabled while `PCP_ADMIN_TOKEN` is configured because the environment variable owns the credential.

## Admin Topics

### GET `/topics`

Lists topics with session counts.

### POST `/topics`

Creates a topic. `title` is optional and free-text: omit it (or send `{}`) and
the server generates a unique default name (`New Topic`, `New Topic 2`, ...).
Duplicate titles are auto-suffixed instead of rejected.

Body:

```json
{
  "title": "Research",
  "description": "optional"
}
```

### POST `/topics/:id/rename`

Renames a topic.

Body:

```json
{
  "title": "new-title"
}
```

### POST `/topics/:id/archive`

Archives or restores a topic. Body (optional): `{ "archived": false }` to
restore from trash. When omitted, the topic is archived (`archived: true`).

### DELETE `/topics/:id`

Permanently deletes a topic from trash. Sessions under it move to Uncategorized.

### DELETE `/sessions/:id`

Permanently deletes a session and all its child data (messages, tokens,
compactions, events).

### POST `/trash/empty`

Permanently deletes ALL archived sessions and topics. Returns
`{ sessions_deleted, topics_deleted }`.

## Admin Sessions

### GET `/sessions`

Lists every session across all topics, including uncategorized ones
(`topic_id: null`). Used by the dashboard to group sessions by topic.

### POST `/sessions`

Creates a session. `topic_id` is optional — omit it for an **uncategorized**
(no-topic) session. `title` is optional and auto-suffixed for uniqueness within
the topic group (or the uncategorized group).

Body (all fields optional):

```json
{
  "title": "Conversation title",
  "topic_id": "topic_123"
}
```

### GET `/topics/:topicId/sessions`

Lists sessions inside a topic.

### POST `/topics/:topicId/sessions`

Creates a session inside a topic. `title` is optional: omit it for a unique
default name (`New Session`, `New Session 2`, ...) within the topic. Duplicate
titles are auto-suffixed.

Body:

```json
{
  "title": "Conversation title"
}
```

### GET `/sessions/:id`

Returns session details with topic title.

### PATCH `/sessions/:id`

Updates session metadata.

Body:

```json
{
  "title": "New title",
  "topic_id": "topic_123",
  "archived": false
}
```

At least one field is required. `topic_id: null` moves the session to
Uncategorized (no topic). `public: true` enables a read-only public view;
`public: false` makes it private again. `archived: true` removes the session
from the active list; `archived: false` restores it.

### POST `/sessions/:id/import`

Human fallback import (UI token). When an agent cannot upload from its sandbox,
the admin pastes the agent's fallback block here. Accepts the same forgiving
formats as agent ingest — a `{ "messages": [...] }` block, an agent wrapper
object that contains a `messages` array, `<PCP_APPEND>`/`<PCP_COMPACT>`,
ChatML-like arrays, or a plain transcript. Messages already present (matched by
role + content) are skipped, so re-pasting merges cleanly.

Body: `{ "payload": "<pasted text>" }` (or the raw pasted text). Response:
`{ success, imported_as: "messages"|"compact", imported, skipped }`.

### GET `/sessions/:id/review`

Returns messages for review.

### PATCH `/sessions/:id/messages/:messageId`

Admin message correction (UI token). Edits a wrongly-recorded/imported message:
`{ "content": "..." }`. The append-only rule applies to AI tokens only; this
human-admin path is audited (`message.edited`).

### POST `/sessions/:id/messages/delete`

Admin bulk delete (UI token). Removes wrongly-recorded/imported messages:
`{ "message_ids": ["msg_...", ...] }` (one or many). Only ids belonging to the
session are deleted; audited (`message.deleted`).

### GET `/sessions/:id/events`

Returns audit events for a session.

### GET `/sessions/:id/compactions`

Returns the durable compaction summaries for a session (additional records that
never replace raw messages). The workspace renders these as readable,
system-prompt-style cards. If a session has compactions but no messages, the
messages pane shows "No raw messages recorded. This session has compact
summaries."

### POST `/sessions/:id/archive`

Archives a session.

## Tokens

### GET `/sessions/:sessionId/tokens`

Lists token metadata for the session (never the secret): name, status
(`active`, `expired`, `revoked`), `expires_at`, and `last_used_at`.

### DELETE `/sessions/:sessionId/tokens`

Permanently deletes a token from the database after a 3-second undo window.
Body: `{ "token_id": "tok_..." }`.

### PATCH `/sessions/:sessionId/tokens`

Renames a token. Body: `{ "token_id": "tok_...", "name": "New name" }`. Body: `{ "token_id": "tok_...", "name":
"New name" }` to rename (names are kept distinct within the session), or
`{ "token_id": "tok_...", "revoke": true }` to revoke. A revoked token is
rejected on every subsequent request.

### POST `/sessions/:sessionId/tokens`

Creates a session access token and returns it once, together with the recording
URL and a ready-to-paste agent instruction.

Body (all fields optional):

```json
{
  "name": "Claude session",
  "can_rename_session": false,
  "expires_in": "7d"
}
```

- `name` defaults to `<session title> access token`.
- `expires_in` is one of `1h`, `24h`, `7d`, `30d`, `never`. Default is `7d`.
  `never` stores a NULL `expires_at`; expired tokens are rejected at auth time.

Response (token shown only here):

```json
{
  "success": true,
  "access_token": "<raw token, shown once>",
  "recording_url": "https://<domain>/r/<sessionId>",
  "instruction": "You are recording this conversation to Personal Context Protocol. ...",
  "expires_in": "7d",
  "expires_at": "2026-06-30T00:00:00.000Z",
  "status": "active"
}
```

## Agent Recording (URL + token)

An external AI agent needs only two things: a **recording URL** and an **access
token**. The URL carries all non-secret session information and is the entry
point for discovering upload routes; the token is the only credential. Agent
routes return a structured envelope:

```json
{
  "ok": false,
  "code": "TOKEN_EXPIRED",
  "retryable": false,
  "message": "The session token expired.",
  "next_steps": ["Ask the user to generate a new access token."]
}
```

### GET `/r/:sessionId` (public)

Recording URL entry point. By default it returns a **self-contained markdown
instruction document** (`text/markdown`): consent framing, the upload and
read-back routes with exact `curl` examples, the canonical transcript format,
limits, and mode guidance. This is why the human prompt can be just "URL +
token" — the agent fetches the URL and reads everything else there.

Content negotiation: `?format=json` (or `Accept: application/json`) returns the
structured protocol descriptor instead; `?format=md` forces markdown. No token
required for either form (only non-secret session information is exposed).

### GET `/r/:sessionId/transcript` (access token)

Session read-back as a raw markdown transcript (`### @role` sections),
authenticated with `Authorization: Bearer <access-token>`. This is the
cross-device sync pull: an agent on a new device fetches this single URL and
receives the recorded conversation in the same human-readable format it records
in. The document is itself re-importable (paste or POST it to `ingest`). Also
advertised as `read_transcript` in the protocol descriptor.

### GET `/api/v1/agent/resolve?url=<recording-url>` (public)

Resolves a recording URL to its protocol descriptor.

### GET `/api/v1/agent/sessions/:sessionId/protocol` (public)

Returns the protocol descriptor: `auth`, `routes` (`read_messages`,
`read_transcript`, `record_messages`, `record_compact`, `ingest_any`),
`instructions_url` + `transcript_url` + `preferred_upload_format`,
`allowed_actions` (note
`manage_topics: false`), `limits` (`max_messages_per_request: 50`,
`max_content_chars: 100000`), `existing_message_count`, a `hint`, and
`recording_mode` + `recording_guidance`. The mode is `wild` (the agent may
redact unsafe secrets) or `exact` (record verbatim, including credentials, for
task migration). Fetch `read_messages` to discover the full conversation history,
then record ALL messages — not only the current exchange.

### POST `/api/v1/agent/sessions/:sessionId/messages`

Append-only message recording. Same body as the legacy message route; requires
`Authorization: Bearer <access-token>`.

### POST `/api/v1/agent/sessions/:sessionId/compact`

Stores a durable session summary when full message upload is impossible.
Compactions are additional records and never replace raw messages.

Body (`summary` required):

```json
{ "summary": "...", "decisions": ["..."], "open_questions": ["..."] }
```

### POST `/api/v1/agent/sessions/:sessionId/ingest`

Forgiving ingestion; the **primary upload route**. The preferred body is a raw
markdown transcript — `### @user` / `### @assistant` section headings with the
message text below each, optionally wrapped in
`<PCP_TRANSCRIPT>...</PCP_TRANSCRIPT>` — sent as `text/markdown` or
`text/plain`. No JSON escaping is required and the payload stays human-readable
end to end. A content line that itself starts with `### @` is escaped as
`\### @`.

Also accepted (backward compatible): raw JSON with top-level `messages` or
`summary`, `{ messages, compaction }` (mixed), `<PCP_INGEST>...</PCP_INGEST>`,
`<PCP_APPEND>...</PCP_APPEND>`, `<PCP_COMPACT>...</PCP_COMPACT>`, ChatML-like
arrays, or loose `User:` / `Assistant:` transcript lines. Messages already
present are skipped. On failure it returns structured retry guidance
(`code: "UNPARSEABLE_PAYLOAD"`), not a vague error. Response:

```json
{
  "ok": true,
  "session_id": "ses_...",
  "imported": { "messages": 12, "compactions": 0, "events": 1, "duplicates_skipped": 0 },
  "notice": "Imported message-level content."
}
```

### POST `/api/v1/agent/sessions/:sessionId/ingest-dry-run`

Validates a fallback payload **without storing** anything. Returns
`{ ok, valid, would_import: { messages, compactions }, warnings }` when valid, or
a structured `{ ok: false, valid: false, code: "INVALID_INGEST_SCHEMA",
retryable, message, next_steps }` when invalid (for example, a message missing
`content`).

### GET `/api/v1/agent/sessions/:sessionId/review`

Scoped message read (access token). Returns all messages already recorded in
this session so the agent knows the full conversation history and can pick up
from the next ordinal. This is the `read_messages` route from the protocol
descriptor.

## AI Message Append (legacy)

### POST `/sessions/:sessionId/messages`

Appends messages to the session bound to the bearer token. Retained for
back-compat; new agents should use `/api/v1/agent/sessions/:sessionId/messages`.

Body:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "provider": "unknown",
      "base_model": "unknown"
    },
    {
      "role": "assistant",
      "content": "Hi.",
      "provider": "anthropic",
      "base_model": "claude"
    }
  ],
  "suggested_session_title": "Greeting"
}
```

Rules:

- `messages` must contain 1 to 50 messages.
- `role` must be `user`, `assistant`, `system`, `tool`, or `correction`.
- `content` is required.
- Topic fields are not accepted.
- `suggested_session_title` requires a token with rename permission; the server
  normalizes it and auto-suffixes duplicates within the topic.

## Public

### GET `/public/sessions/:id` (public)

Read-only view of a session and its messages when the session is marked
`public`. No admin token required. A private or missing session returns 404 so a
private session's existence is not leaked. Tokens are never exposed. The `/s/:id`
page renders this.

## Agent Schemas (public)

These endpoints return machine-readable JSON schemas so an agent can generate
correct payloads without guessing or searching the web. The name "Personal
Context Protocol" has been reused by unrelated projects — use ONLY these
definitions, not web search results.

### GET `/agent/schema/message`

Returns the JSON schema for the `POST record_messages` payload.

### GET `/agent/schema/compact`

Returns the JSON schema for the `POST record_compact` payload.

### GET `/agent/schema/ingest`

The canonical fallback schema (public, no token). Returns `{ ok, schema_version,
schema_name, accepted_content_types, accepted_wrappers, preferred_format,
transcript_example, limits, modes, ingest_example,
compact_example }`. `modes` defines `wild` (redaction allowed) and `strict`
(exact preservation requested). This is the single source of truth shared with
the generated copy-paste fallback prompts — agents should use ONLY these
definitions, not web search results for "Personal Context Protocol".

## Recording URL origin

The browser UI builds the recording URL from `window.location.origin` (where the
admin opened the app), so it always matches the deployment. Server-side,
`PCP_APP_URL` is used only when it is a valid absolute `http(s)` URL; an
unexpanded template such as the literal `${VERCEL_URL}` is ignored in favor of
the request origin. `PCP_APP_URL` is about constructing absolute URLs, not CORS.

## Export

### GET `/export`

Exports app data as JSON for the UI token holder.

The export omits plaintext tokens.

