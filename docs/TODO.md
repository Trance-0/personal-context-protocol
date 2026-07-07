# TODO

Owner-visible future work for Personal Context Protocol. Keep this list focused on versioned product work, not per-round scratch notes.

## v0.1 Completed

- [x] **Core schema and API**
  - [x] App instance and UI auth tables
  - [x] Topic, session, session token, message, event, and migration tables
  - [x] Setup, auth check, topic, session, token, message, event, and export routes
  - [x] API route handlers served from `src/app/api/v1`
  - [x] API routes marked dynamic so builds do not execute runtime database handlers

- [x] **Setup and authentication**
  - [x] Deploy initialization creates schema, app instance, and the first admin credential
  - [x] One-time fallback setup token returned in the browser setup response
  - [x] Admin login page prompts for the UI token before dashboard access
  - [x] Admin login page prompts for fallback initialization when the database is not initialized
  - [x] `/api/v1/auth/check` validates the UI token before saving it in browser storage
  - [x] Direct `/dashboard` access without `ui_token` redirects to `/login?next=/dashboard`
  - [x] Automatic Postgres schema bootstrap when setup status/init runs with `DATABASE_URL`

- [x] **Session workspace UI**
  - [x] Topic creation and selection
  - [x] Session creation, editing, moving, archiving, and restoring
  - [x] Session token generation with copy-to-clipboard
  - [x] Message and event review views
  - [x] Dashboard split into focused topic, session, and workspace components

- [x] **Frontend shell**
  - [x] Public introduction page
  - [x] Light, dark, and system theme toggle
  - [x] Published documentation links use GitHub Pages
  - [x] Footer links for documentation, API reference, deployment, and future work

- [x] **Diagnostics and docs**
  - [x] Error messages include consequence, module/process, and cause
  - [x] Build/runtime diagnostics identify missing required env vars without printing secrets
  - [x] Build/start deploy initialization prints PCP-generated first-login admin tokens when `PCP_ADMIN_TOKEN` is absent
  - [x] Sphinx documentation build root fixed
  - [x] README and protocol docs updated for implemented routes

## v0.1.3 Completed — Agent recording URL

Shipped within the v0.1 line. The agent recording-URL surface and token
expiration land here as part of v0.1; the move to **v0.2.0 is gated on
completing v0.1 Remaining Hardening below**, not on shipping this feature.

- [x] **Recording URL + token model**
  - [x] `GET /r/:sessionId` public recording-URL entry point
  - [x] `GET /api/v1/agent/resolve?url=` and `GET /api/v1/agent/sessions/:id/protocol`
  - [x] Self-describing protocol (auth, routes, allowed_actions, limits)
  - [x] Copyable Recording URL + Access Token pair in the session UI

- [x] **Agent ingestion**
  - [x] `POST /api/v1/agent/sessions/:id/messages` append (append-only)
  - [x] `POST /api/v1/agent/sessions/:id/compact` durable summaries (additional records)
  - [x] `POST /api/v1/agent/sessions/:id/ingest` forgiving parser (JSON, PCP tags, ChatML, transcript)
  - [x] Structured `{ ok, code, retryable, message, next_steps }` agent errors

- [x] **Token expiration**
  - [x] `expires_in` choices (1h/24h/7d/30d/never), default 7d, NULL = never expire
  - [x] Reject expired tokens; show active/expired/revoked + last used in UI

- [x] **Naming**
  - [x] One-click topic/session creation with generated default names
  - [x] Duplicate title auto-suffixing; AI-suggested title normalization

## v0.1.4–v0.1.10 Completed — Operability & correction

Shipped within the v0.1 line (still gated on v0.1 Remaining Hardening before v0.2).

- [x] **Admin token rotation** (v0.1.4–v0.1.6): per-deploy rotation unless set in
  Settings (`user`) or `PCP_ADMIN_TOKEN` (`env`); recovery guidance + dashboard warning
- [x] **Public sessions** (v0.1.7): `sessions.public`, read-only `/s/:id` + public API; 404 for private
- [x] **Token management** (v0.1.7, v0.1.9): revoke + rename via PATCH; auto-distinct token names; dashboard modal
- [x] **Recording URL origin fix** (v0.1.7): UI builds from `window.location.origin`; server ignores non-absolute `PCP_APP_URL`
- [x] **Front-page polish** (v0.1.7): load animations; footer shows deployed version
- [x] **Uncategorized sessions + ChatGPT-style nav** (v0.1.5): nullable `topic_id`; collapsible groups; right-click/long-press menu
- [x] **Human fallback import** (v0.1.8): paste agent fallback block; dedup-merge already-recorded messages
- [x] **Recording modes** (v0.1.9): `sessions.mode` wild/exact surfaced to the agent
- [x] **Message correction** (v0.1.10): human admin edit/delete (append-only still enforced for AI);
  multi-select with select-all + shift-range; long messages fold to 5 lines in select mode

## v0.1.23 Completed — Copy feedback, drag jitter, agent titling

- [x] **Copy shows "Copied"** — the token-block modal's Copy button now flashes
  a green "Copied" state (with check icon) on a successful clipboard write and
  stays unchanged when clipboard access is denied, so the user knows to copy
  manually
- [x] **Drag-to-recategorize jitter fixed** — `onDragOver` no longer calls
  `onToggleExpand` on every event (which thrashed the folder open/closed while
  hovering). Drop targets now show a steady ring highlight, and a collapsed
  topic auto-expands once after ~550 ms of hovering; the timer is cancelled on
  drag leave/drop/end
- [x] **Agents now title sessions to fit the conversation** — three root causes
  fixed:
  - `can_rename_session` defaulted to `false`, so agent title suggestions were
    rejected with FORBIDDEN; new tokens now default to `true`
  - the primary markdown transcript path had no title channel; the parser now
    reads `title="…"` from the `<PCP_TRANSCRIPT>` tag (and
    `suggested_session_title` / `session_title` from JSON payloads, ignoring
    the schema placeholder), and the agent ingest route applies it — dropped
    silently for restricted tokens instead of failing the ingest
  - instructions barely mentioned titling; the recording-URL document, shared
    recording prompts, minimal prompt, and Wild/Strict fallback prompts now
    all require a concise 3–8-word title (not "Chat"/"New Session"), and the
    transcript examples carry a `title` attribute; the export panel emits
    `title="…"` (quote-escaped) so exports round-trip the title too
- [x] Tests: copied-state markup compiles; 7 new title-channel tests (tag
  attribute single/double quotes, unclosed tag, JSON aliases, placeholder
  ignored, instruction-doc requirement); 149 tests pass

## v0.1.22 Completed — Markdown-first protocol (URL + token is the whole prompt)

Goal: no capable agent refuses the sync request, and the human hands over only
a URL + token. The refusal driver was JSON-first everything; the raw markdown
transcript is now the canonical, human-readable wire format in both directions.

- [x] **Self-describing recording URL** — `GET /r/:sessionId` serves a
  self-contained markdown instruction document by default (consent framing,
  scoped append-only token semantics, exact curl examples, transcript format,
  limits, mode guidance, existing message count). JSON descriptor still served
  via `?format=json` / `Accept: application/json`; `?format=md` forces markdown
- [x] **Canonical markdown transcript** — `### @role` sections with `\### @`
  escaping (round-trip safe), optional `<PCP_TRANSCRIPT v=1 mode=…>` wrapper;
  parser accepts the block (attributes tolerated, unclosed tag recovered,
  agent preamble prose ignored) ahead of all JSON forms; JSON/ChatML/legacy
  wrappers remain accepted
- [x] **Transcript read-back** — `GET /r/:sessionId/transcript` (bearer token)
  returns the session as a re-importable markdown document; advertised as
  `read_transcript` + `transcript_url` in the protocol descriptor. This is the
  cross-device context pull for the "sync Claude across devices" flow
- [x] **Minimal prompt** — `buildMinimalInstruction` (URL + token + two steps)
  is now what Generate token copies and is returned as `minimal_instruction`
  from the token route; full prompts rewritten transcript-first
- [x] **Fallback prompts** — Wild/Strict copy-paste prompts now request a
  `<PCP_TRANSCRIPT>` markdown block (no JSON, no escaping pitfalls); strict
  redaction notes move to `> redacted:` lines; JSON form documented as the
  structured-output alternative
- [x] **Export round-trip** — Import/Export panel copies/downloads the session
  as a canonical `<PCP_TRANSCRIPT>` document (wild redacts via `redactSecrets`);
  pasting it into another session's Import box reproduces the messages
- [x] **Schema descriptor** — advertises `text/markdown`, `PCP_TRANSCRIPT`
  wrapper, `preferred_format`, and a `transcript_example`
- [x] Tests: transcript render/parse round-trips (incl. heading-like content),
  wrapper/attribute/unclosed-tag recovery, instruction document invariants
  (no token, consent framing, offline path), minimal-prompt shape; docs synced
  (protocol.md, agent-instructions.md, README cross-device recipe)

## v0.1.21 Completed — Consent-framed token prompts + layout scroll fix

- [x] **Refusal-aware token prompts** — `buildAgentInstruction` /
  `buildImportInstruction` / `buildExportInstruction` rewritten through a shared
  consent-framed builder: states the request is first-party (user's own
  instance, user's own credential), gates direct upload behind the agent
  actually having a web/MCP tool, and offers "produce import JSON for the user
  to paste" as a preferred non-refusal fallback. Removed the injection-prone
  phrasing ("discover upload routes", "recall ALL past history", "upload every
  message", "transmit the token as content")
- [x] **Dashboard scroll fix** — added the `min-h-0` chain so nested
  flex/grid scrollers are no longer clipped by the fixed-height
  (`calc(100vh-57px)`) `overflow:hidden` page grid: workspace section + inner
  column, the messages/events grid row, and an independent scroller on the
  events column. Messages region and pinned Import composer/footer are now
  reachable

## v0.1.20 Completed — Refusal-aware fallback, export, dry-run

- [x] **Generated prompts** — Wild/Strict copy-paste fallback (no token, no
  upload, produce review-able JSON) and MCP/tool direct-upload prompt; refusal-
  prone phrasing removed from fallback prompts
- [x] **Terminology** — `exact` surfaced as `strict` in UI/docs (display alias;
  stored value unchanged); `normalizeRecordingMode` accepts `strict`
- [x] **Schema endpoint** — `GET /api/v1/agent/schema/ingest` returns the spec
  shape (wild + strict modes, `ingest_example`, `compact_example`, limits)
- [x] **Export** — Import/Export panel: copy/download PCP_INGEST + PCP_COMPACT
  JSON (`.json` / `.md`); wild redacts secrets, strict preserves stored text
  exactly (with a warning); mode badge
- [x] **Dry-run** — `POST /api/v1/agent/sessions/:id/ingest-dry-run` validates
  without storing; actionable structured errors
- [x] **Ingest response** — `{ imported: { messages, compactions, events,
  duplicates_skipped }, notice }` on agent ingest and human import

## v0.1 Remaining Hardening

- [x] **Startup validation**
  - [x] Add shared configuration validator for `DATABASE_URL`, `PCP_INSTANCE_SECRET`, and `PCP_APP_URL`
  - [x] Validate malformed values, not only missing values
  - [x] Surface deployment configuration errors in the setup UI without exposing secrets

- [ ] **Setup integration tests**
  - [ ] Missing `DATABASE_URL`
  - [ ] Unreachable Neon database
  - [ ] Empty database schema bootstrap
  - [ ] Duplicate initialization
  - [ ] Invalid admin token login attempt

- [ ] **Security audit**
  - [ ] Resolve current `npm audit` findings, including the Next.js 14.2.5 warning
  - [ ] Add CI security scanning
  - [ ] Add automated checks that logs never include plaintext admin or session tokens

- [ ] **API docs sync**
  - [x] Generate or validate docs against `src/app/api/v1` (drift test)
  - [ ] Add CI route/doc drift check
  - [ ] Keep README endpoint list in sync with protocol docs

- [x] **Agent import visibility and compaction rendering**

  * Context: A user pasted a valid `PCP_COMPACT` block into the import flow. The UI reported `Imported a compaction block`, but the session message view showed no readable conversation content.
  * Trigger: Import a `PCP_COMPACT` payload that contains `summary`, `timeline`, `decisions`, or `requirements`, but no `messages` array.
  * Missing behavior: The app stores the compaction but does not make it visible in the session workspace as first-class readable content.
  * Expected UI output:

    * The session workspace has a `Compactions` tab or section next to `Messages` and `Events`.
    * If the session has compactions but no messages, the Messages pane shows: `No raw messages recorded. This session has compact summaries.`
    * The Compactions pane shows cards with `summary`, `timeline`, `decisions`, `requirements`, `open_questions`, `artifacts`, and `warnings` when present.
  * Expected API/import response:

    ```json
    {
      "ok": true,
      "imported": {
        "messages": 0,
        "compactions": 1,
        "events": 1
      },
      "session_id": "ses_...",
      "notice": "Imported a compact summary. No raw messages were included."
    }
    ```
  * Implementation tasks:

    * [x] Add or verify a `compactions` table/model.
    * [x] Render compactions in the session workspace.
    * [x] Make `PCP_COMPACT` with no messages store a compaction, not fake message rows.
    * [x] Make `PCP_COMPACT` (and `PCP_INGEST`) with a `messages` array import both messages and the compaction.
    * [x] Add an audit event for compact import (compaction.recorded).
    * [x] Add tests for compact-only import and compact-with-messages import.

* [ ] **Canonical agent fallback format** — *superseded in v0.1.22: the
  canonical fallback is now the `<PCP_TRANSCRIPT>` markdown block (JSON forms
  remain accepted for backward compatibility); the JSON-canonical plan below is
  kept for reference only.*

  * Context: Different agents are returning incompatible fallback formats. Some return generic JSON, some return `PCP_COMPACT`, and some omit fields required for message recording.
  * Trigger: Give an agent a Recording URL and Access Token, then ask it to record a session when direct upload is unavailable.
  * Missing behavior: The generated prompt does not force a single canonical fallback shape for message-level recording.
  * Expected output from agents when API upload fails but messages are reconstructable:

    ```text
    <PCP_INGEST>
    {
      "schema_version": 1,
      "session_id": "ses_...",
      "session_title": "optional suggested title or null",
      "messages": [
        {
          "role": "user | assistant | system | tool | unknown",
          "content": "",
          "content_type": "text/markdown",
          "created_at": null,
          "observed_at": "ISO timestamp",
          "provider": "chatgpt | claude | gemini | cursor | codex | unknown",
          "agent_name": "unknown",
          "base_model": "unknown",
          "attachments": [
            {
              "title": "",
              "media_type": "",
              "download_url": "",
              "description": ""
            }
          ],
          "metadata": {}
        }
      ],
      "compaction": null
    }
    </PCP_INGEST>
    ```
  * Expected output from agents only when message-level reconstruction is impossible:

    ```text
    <PCP_COMPACT>
    {
      "schema_version": 1,
      "session_id": "ses_...",
      "session_title": "optional suggested title or null",
      "summary": "",
      "timeline": [],
      "decisions": [],
      "requirements": [],
      "open_questions": [],
      "artifacts": [
        {
          "title": "",
          "media_type": "",
          "download_url": "",
          "description": ""
        }
      ],
      "warnings": [],
      "provider": "unknown",
      "agent_name": "unknown",
      "base_model": "unknown",
      "created_at": "ISO timestamp"
    }
    </PCP_COMPACT>
    ```
  * Implementation tasks:

    * [ ] Update the generated agent instruction to prefer direct upload first, `PCP_INGEST` second, and `PCP_COMPACT` only as last resort.
    * [ ] Update `/api/v1/agent/sessions/:id/ingest` to prefer `PCP_INGEST`.
    * [ ] Keep backward compatibility with `PCP_APPEND`.
    * [ ] Return structured errors when payloads omit required message fields.
    * [ ] Add parser tests for `PCP_INGEST`, legacy `PCP_APPEND`, and `PCP_COMPACT`.

* [ ] **Agent upload diagnostics and MCP connection guidance**

  * Context: Some agents can discover `record_messages`, `record_compact`, and `ingest_any`, but cannot complete upload because their execution environment cannot resolve `pcp.trance-0.com` or cannot send `Authorization: Bearer ...` POST requests.
  * Trigger: An agent replies that it discovered the protocol but cannot claim recording success because upload failed.
  * Missing behavior: The app does not give the user a precise diagnosis or a next operational path.
  * Expected UI output:

    * In the Token / Agent Instruction panel, show a `Connectivity test` button.
    * The test checks:

      * recording URL resolves
      * protocol endpoint responds
      * authenticated `review` endpoint works
      * authenticated dry-run ingest works if implemented
    * On failure, show one of:

      * `DNS resolution failed`
      * `TLS connection failed`
      * `Protocol endpoint unreachable`
      * `Token rejected`
      * `Upload route rejected`
      * `Payload schema rejected`
  * Expected API response for diagnostics:

    ```json
    {
      "ok": false,
      "stage": "dns | tls | protocol | auth | upload | schema",
      "code": "DNS_RESOLUTION_FAILED",
      "retryable": false,
      "message": "The recording host could not be resolved from this environment.",
      "next_steps": [
        "Verify public DNS for pcp.trance-0.com.",
        "Try upload from a local relay or MCP-enabled agent."
      ]
    }
    ```
  * Implementation tasks:

    * [ ] Add documentation for connecting `https://pcp.trance-0.com/mcp` as an MCP server where supported.
    * [ ] Add sample Codex MCP config using `bearer_token_env_var`.
    * [ ] Add sample local relay script that posts `PCP_INGEST` from a file.
    * [ ] Document that prompt-only ChatGPT cannot be forced to send custom authenticated POST requests unless connected through MCP/tools/actions.
    * [ ] Do not describe CORS or trusted origins as a solution for model-side POST capability.

* [ ] **Message viewport containment**

  * Context: Current message panes can overflow the browser window and push other widgets out of view.
  * Trigger: Open a session with long messages, long code blocks, or many events.
  * Missing behavior: The app shell does not constrain message/event/session panels to the viewport.
  * Expected UI output:

    * Header, sidebar, session workspace, message list, event list, and token widgets remain inside the browser viewport.
    * Message list scrolls internally with `overflow-y: auto`.
    * Event list scrolls internally with `overflow-y: auto`.
    * Session/sidebar list scrolls internally with `overflow-y: auto`.
    * Long code blocks scroll horizontally inside the message bubble instead of widening the page.
  * Implementation tasks:

    * [ ] Convert the dashboard/workspace shell to a viewport-height layout.
    * [ ] Add internal scroll containers for message, event, and session lists.
    * [ ] Prevent page-level overflow except on narrow screens where intentional.
    * [ ] Add regression test or visual check using a long message and a long code block.

* [ ] **ChatGPT-like message alignment**

  * Context: Message alignment is currently wrong. System, user, and assistant messages are not visually differentiated in a readable chat flow.
  * Trigger: Open any recorded session with user and assistant messages.
  * Missing behavior: Message role is not mapped to consistent layout.
  * Expected UI output:

    * `system`: full-width horizontal card.
    * `user`: right-aligned bubble.
    * `assistant` or `agent`: left-aligned bubble.
    * `tool` or `unknown`: neutral full-width or left-aligned card with visible role label.
    * All bubbles wrap long text.
    * Code blocks scroll horizontally inside the bubble.
  * Implementation tasks:

    * [ ] Add role-to-layout mapping.
    * [ ] Add role labels for non-user/non-assistant messages.
    * [ ] Add CSS tests/snapshots or component tests for role alignment classes.
    * [ ] Verify markdown and code rendering do not break layout.

* [ ] **Session movement between topics**

  * Context: Users need to reorganize sessions after creation. Topic management is human-only, but the UI should allow a session to be reassigned to another topic/folder.
  * Trigger: User drags a session from one topic group to another in the sidebar.
  * Missing behavior: Sidebar does not support drag-to-reassign or does not persist the session��s new topic.
  * Expected UI output:

    * Dragging a session over a topic highlights the target topic.
    * Dropping the session moves it under the target topic.
    * A toast appears: `Moved session to <topic title>.`
    * The session ID remains unchanged.
    * The message list remains unchanged.
  * Expected database/API behavior:

    * Update only `sessions.topic_id`.
    * Append an event with kind `session_moved_topic`.
    * Reject this operation for AI session tokens.
  * Implementation tasks:

    * [ ] Add admin-only API route or server action for moving a session to another topic.
    * [ ] Add drag-and-drop in the sidebar.
    * [ ] Add audit event for the move.
    * [ ] Add tests that UI/admin auth can move sessions.
    * [ ] Add tests that AI tokens cannot move sessions.

* [ ] **Sidebar scaling and lazy session rendering**

  * Context: Topics with many sessions make the sidebar hard to scan and may render too many items at once.
  * Trigger: Create or import many sessions under one topic.
  * Missing behavior: The sidebar renders too many sessions and lacks progressive disclosure.
  * Expected UI output:

    * Each topic initially shows the 5 most recently updated sessions.
    * A `Show more` button appears when more sessions exist.
    * Clicking `Show more` reveals the next batch.
    * Sessions are sorted by `last_message_at` first, then `updated_at`, descending.
    * Sidebar scrolls internally and does not push the page height.
  * Implementation tasks:

    * [ ] Limit initial session render to 5 per topic.
    * [ ] Add per-topic `Show more`.
    * [ ] Use server-side limit/pagination where practical.
    * [ ] Add tests for initial 5-session render and expansion.

* [ ] **Precise topic and session default naming**

  * Context: Topic/session creation can produce blank, duplicate, or confusing names. User wants one-click creation without being forced to name the object first.
  * Trigger: User clicks `New Topic` or `New Session` repeatedly.
  * Missing behavior: Name generation is not deterministic and duplicate-safe enough.
  * Expected UI output:

    * Topic defaults:

      * `New Topic`
      * `New Topic 2`
      * `New Topic 3`
    * Session defaults within a topic:

      * `New Session`
      * `New Session 2`
      * `New Session 3`
    * If a human enters duplicate topic title `Research`, create or suggest `Research 2` instead of blocking.
    * If an AI suggests duplicate session title `Route B Build Prompt`, normalize to `Route B Build Prompt 2`.
  * Implementation tasks:

    * [ ] Implement `normalizeTitle(input)`.
    * [ ] Implement `dedupeTitle(baseTitle, existingTitles)`.
    * [ ] Implement `generateUniqueTopicTitle(baseTitle)`.
    * [ ] Implement `generateUniqueTopicSlug(baseTitle)`.
    * [ ] Implement `generateUniqueSessionTitle(topicId, baseTitle)`.
    * [ ] Add tests for blank titles, repeated default titles, and duplicate AI-suggested titles.

* [ ] **Session content search**

  * Context: Current search is insufficient if it only searches session title. Users need to find sessions by message content and compact summaries.
  * Trigger: Search for a keyword that appears inside a recorded message or compaction but not in the session title.
  * Missing behavior: Search does not inspect message content or compaction content.
  * Expected UI output:

    * Add independent `Search Sessions` modal or page.
    * Results include session title, topic title, match type, and snippet.
    * Snippet includes roughly 20 words before and after the match.
    * Matched terms are highlighted.
    * Clicking a result opens the session and scrolls/highlights the target message or compaction when possible.
  * Expected API:

    ```http
    GET /api/v1/search/sessions?q=<query>&limit=20&offset=0
    ```

    ```json
    {
      "results": [
        {
          "session_id": "ses_...",
          "session_title": "...",
          "topic_id": "topic_...",
          "topic_title": "...",
          "match_type": "message | compaction | title",
          "message_id": null,
          "compaction_id": null,
          "snippet": "...",
          "highlight_ranges": [
            { "start": 10, "end": 18 }
          ],
          "updated_at": "ISO timestamp"
        }
      ],
      "next_offset": null
    }
    ```
  * Authorization:

    * UI/admin token can search all sessions.
    * AI session token cannot search all sessions.
  * Implementation tasks:

    * [ ] Search session titles.
    * [ ] Search message content.
    * [ ] Search compaction summary, timeline, decisions, requirements, and open questions.
    * [ ] Add keyword highlighting.
    * [ ] Add result navigation to target session/message/compaction.
    * [ ] Use Postgres full-text search if low-risk; otherwise use safe `ILIKE` for v0.1 and keep the API upgradeable.
    * [ ] Add tests for message-content search, compaction search, snippets, highlights, and authorization.

* [ ] **Structured agent error contract**

  * Context: Agents recover poorly from vague server errors and may reply with inconsistent fallback blocks.
  * Trigger: Send malformed `PCP_INGEST`, expired token, forbidden topic mutation, or oversized payload.
  * Missing behavior: Errors are not consistently actionable for an AI agent.
  * Expected API error shape:

    ```json
    {
      "ok": false,
      "code": "INVALID_INGEST_SCHEMA",
      "retryable": true,
      "message": "The payload did not match PCP_INGEST or PCP_COMPACT.",
      "next_steps": [
        "Retry with PCP_INGEST if you can reconstruct messages.",
        "Retry with PCP_COMPACT if only a summary is available."
      ]
    }
    ```
  * Required error cases:

    * `TOKEN_EXPIRED`
    * `TOKEN_REVOKED`
    * `TOKEN_SCOPE_FORBIDS_ACTION`
    * `TOPIC_MANAGEMENT_FORBIDDEN`
    * `INVALID_INGEST_SCHEMA`
    * `PAYLOAD_TOO_LARGE`
    * `MESSAGE_TOO_LARGE`
    * `UNSUPPORTED_CONTENT_TYPE`
  * Implementation tasks:

    * [ ] Normalize all agent-facing route errors to this shape.
    * [ ] Ensure errors never echo the access token.
    * [ ] Add tests for each required error case.

* [ ] **Acceptance checks for this hardening batch**

  * [ ] `npm run typecheck` passes.
  * [ ] `npm run test` passes.
  * [ ] `npm run build` passes.
  * [ ] Importing compact-only content makes a visible compaction card.
  * [ ] Importing message-shaped fallback content creates visible chat messages.
  * [ ] Long messages and events scroll inside the viewport.
  * [ ] User, assistant, system, tool, and unknown roles render with the expected alignment.
  * [ ] Recording URL + Access Token flow still works.
  * [ ] AI tokens cannot manage topics, move sessions, or search all sessions.
  * [ ] User can drag sessions between topics.
  * [ ] Sidebar only shows the first 5 recent sessions per topic until `Show more`.
  * [ ] Search finds keywords inside message content and compactions.
  * [ ] Structured errors are returned for malformed agent uploads.


## v0.2 Protocol Features

- [ ] **Token management**
  - [ ] Token revocation UI
  - [ ] Token revocation API flow
  - [ ] Audit events for token revocation
  - [x] Manual custom admin token from the settings page
  - [x] Recovery path for lost UI token through `PCP_ADMIN_TOKEN` without printing tokens to logs
  - [x] Missing admin credential repair during setup/init
  - [ ] Full UI token rotation flow with audit event history

- [ ] **Admin features**
  - [ ] Replace browser-local token storage if stronger admin unlock semantics are needed
  - [ ] Direct topic detail endpoint
  - [ ] Direct message read endpoint
  - [ ] Export download controls in the admin UI

- [ ] **Import/export**
  - [ ] Import endpoint for PCP JSON
  - [ ] Import endpoint for PCP JSONL
  - [ ] Import endpoint for generic transcripts
  - [ ] Richer transcript export formats

- [ ] **Query improvements**
  - [ ] Pagination for topics
  - [ ] Pagination for sessions
  - [ ] Pagination for messages
  - [ ] Pagination for event logs
  - [ ] Cross-session search

- [ ] **Advanced context features**
  - [ ] Bulk operations
  - [ ] Attachment support
  - [ ] Semantic search after the core append-only workflow is stable
  - [ ] Summaries and context compression
  - [ ] Auto-tagging

## v0.3 Operations

- [ ] **Deployment diagnostics**
  - [ ] Vercel diagnostics page
  - [ ] Neon diagnostics page
  - [ ] Schema version reporting
  - [ ] Migration state checks
  - [ ] Connection health checks without exposing secrets

- [ ] **Audit logging**
  - [ ] Structured audit-log views
  - [ ] Token creation events
  - [ ] Token revocation events
  - [ ] Message append events
  - [ ] Session rename events
  - [ ] Archive events

- [ ] **Backup and restore**
  - [ ] Neon branch backup documentation
  - [ ] JSON export restore process
  - [ ] Automated backup scripts

- [ ] **Rate limiting and observability**
  - [ ] AI-facing append endpoint rate limiting
  - [ ] Admin token creation rate limiting
  - [ ] Production log guidance with secret redaction requirements
  - [ ] Metrics collection setup
  - [ ] Alerting configuration

- [ ] **Scaling**
  - [ ] Custom domain documentation
  - [ ] Preview environment setup
  - [ ] Monitoring setup guide
  - [ ] Backup and disaster recovery procedures
  - [ ] Horizontal scaling guide

## Later Candidates

- [ ] Multiple admin users without external auth
- [ ] Per-user data isolation
- [ ] Role-based access control
- [ ] OAuth/SSO after the single-admin model is no longer sufficient
- [ ] MFA support
- [ ] IP allowlisting
- [ ] Optional app-level encryption
- [ ] Read-only session sharing with topic fields hidden from AI-facing surfaces
- [ ] Import prior AI conversations while preserving immutable message ordinals
- [ ] Richer correction workflows that link correction messages to original message IDs
- [ ] Local SQLite development profile
- [ ] Signed messages
- [ ] Advanced threat detection

## Status Legend

- [x] Completed and tested
- [ ] Planned or not started

