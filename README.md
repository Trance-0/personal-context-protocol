# Personal Context Protocol (PCP)

Vercel + Neon Postgres web app for scoped AI session recording.

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNesbitt-bot%2Fpersonal-context-protocol&envDescription=Add%20Neon%20database%20and%20environment%20variables%20after%20deployment)

[Documentation](https://nesbitt-bot.github.io/personal-context-protocol/) | [API Spec](docs/protocol.md) | [Vercel Deploy](docs/deployment-vercel-neon.md) | [Docker Compose](docs/deployment-docker-compose.md)

## What It Does

Personal Context Protocol stores AI conversation context in user-managed topics and sessions.

- Admin users create topics and recording sessions in the web UI (one click, no
  naming required — defaults are generated and duplicates auto-suffixed). The
  ChatGPT-style nav shows topics as collapsible groups with nested sessions, plus
  an Uncategorized group for sessions with no topic. Right-click or long-press an
  item to remove it.
- Each session produces a **recording URL + access token** pair — and that pair
  is the whole handoff. The recording URL serves a self-contained, human-readable
  markdown instruction page (JSON descriptor via `?format=json`), so the prompt
  you give an agent is two lines: the URL and the token.
- The wire format is a **raw markdown transcript** (`### @user` / `### @assistant`
  sections) in both directions: agents POST it to record, and pull
  `/r/<sessionId>/transcript` to load recorded context on another device. No JSON
  escaping, human-reviewable end to end; JSON remains accepted for structured
  clients.
- Agents append messages to their assigned session only, or send a compaction
  when full upload is impossible. They never manage topics. Tokens are scoped to
  one session and append-only, and the instruction page says so — which is what
  lets cautious agents pass their own safety screening instead of refusing.
- The admin dashboard previews sessions, events, token status, and exports;
  tokens can be revoked from a modal, and a session can be made public for a
  read-only shared view at `/s/<sessionId>`.
- For agents that **cannot or will not upload**, the session **Import / Export**
  panel generates copy-paste fallback prompts (Wild = redaction allowed, Strict =
  exact preservation) that ask the agent only to produce a review-able
  `<PCP_TRANSCRIPT>` markdown block — no token, no upload, no JSON — which the
  human pastes back into the Import box. Agents with a PCP MCP/tool integration
  get a direct-upload (MCP) prompt instead. Export recorded sessions as a
  round-trippable markdown transcript (`.md`) or PCP JSON (`.json`), and validate
  fallback payloads with the `ingest-dry-run` endpoint.

## Sync your Claude (or any agent) context across devices

The first-class flow this project targets: continue one piece of work across
devices and assistants with minimal typing.

1. In the dashboard, create a session and click **Generate token**. The copied
   block is a minimal two-step prompt containing only the recording URL and the
   token.
2. **Device A** — paste that block into Claude (Code, chat, or any web-capable
   agent). It fetches the URL, reads the instructions there, and records the
   conversation as a plain markdown transcript you can review in the dashboard.
3. **Device B** — tell the agent to continue:

   ```text
   Load my prior context from my self-hosted PCP notebook, then continue the work:
   GET https://<domain>/r/<sessionId>/transcript
   Authorization: Bearer <access-token>
   ```

   The transcript it fetches is the context — human-readable, and re-importable
   anywhere.
4. **Offline / restricted agents** — use the Import/Export panel's Wild/Strict
   prompt instead; the agent outputs a `<PCP_TRANSCRIPT>` block you paste into
   the Import box yourself. Same format, no credentials involved.

## Deploy

PCP ships two fully supported, equally maintained deployment paths. They produce
the same app and use the same idempotent schema bootstrap — pick whichever fits
your hosting. **Vercel + Neon is recommended** for a hosted, zero-ops setup;
**Docker Compose** is the equal alternative for self-hosting or local runs.

Both require the same environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Postgres connection string (Neon, or the Compose `db` service) |
| `PCP_INSTANCE_SECRET` | Random secret, 32+ characters |
| `PCP_APP_URL` | Your app's public URL (optional; the request origin is used otherwise) |
| `PCP_ADMIN_TOKEN` | Optional 32+ character admin/reset token. Leave unset for zero-config first login. |

### Option A — Vercel + Neon (recommended)

1. Click **Deploy to Vercel** and import this repo.
2. Create a Neon project and copy the Postgres connection string.
3. Set the environment variables above in the Vercel project.
4. Deploy. The build initializes the empty database and creates the admin credential.
5. Log in with `PCP_ADMIN_TOKEN` if configured. Otherwise use the generated first-login
   token printed once in Vercel build logs, then change it immediately in **Settings**.

Full guide: [Deployment: Vercel + Neon](docs/deployment-vercel-neon.md).

### Option B — Docker Compose

1. Set the environment variables above (or run `npm run docker:up`, which generates a
   local `.env` with sensible defaults, including a Postgres `db` service).
2. `npm run docker:up` builds the image, starts Postgres, initializes the app, and
   prints the first-login token when `PCP_ADMIN_TOKEN` is unset.
3. Log in the same way as Option A.

Full guide: [Deployment: Docker Compose](docs/deployment-docker-compose.md).

## Admin Token Recovery

The admin credential has one of three sources, with precedence **environment > user > deploy**:

- **deploy** — if you set neither of the below, PCP generates a token during deploy initialization and prints it once in build/start logs. A **fresh token is generated on every deploy**, so the previous deploy token stops working — never reuse an old one. While a deploy token is in use, the dashboard shows a warning banner prompting you to set your own.
- **env** — set `PCP_ADMIN_TOKEN` (32+ chars) and redeploy. The env var owns the credential, overrides any generated token, stops per-deploy rotation, and is never printed in logs.
- **user** — after login, use **Settings** to set a custom token. That marks the credential user-managed so deploys stop rotating it. Settings rotation is disabled while `PCP_ADMIN_TOKEN` is configured because the env var owns the credential.

If you entered the wrong password: find the current token in your **most recent** deploy logs (banner containing `Admin token:`), or set `PCP_ADMIN_TOKEN` and redeploy. The login page links to the [admin token recovery guide](https://nesbitt-bot.github.io/personal-context-protocol/deployment-vercel-neon.html#admin-token-recovery).

## Local Development

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Run checks:

```bash
npm run typecheck
npm run test:run
npm run build
```

## Token Model

### UI/admin token

- Unlocks the admin UI and protected admin API routes.
- Stored as a salted hash in Postgres.
- Generated during deploy initialization when `PCP_ADMIN_TOKEN` is not configured; the generated first-login token is printed once in build/start logs.
- Can be rotated from the Settings page after login.

### AI session access token

- Generated per session and shown once, paired with the session's recording URL.
- Stored as a salted hash with a token prefix for lookup.
- Scoped to exactly one session.
- Expiration is chosen at creation: `1h`, `24h`, `7d` (default), `30d`, or
  `never`. Expired or revoked tokens are rejected; tokens created before
  expiration existed are treated as never-expiring.
- Can append messages, record compactions, and optionally suggest its session
  title. Cannot manage topics.

## Documentation

Published docs: https://nesbitt-bot.github.io/personal-context-protocol/

Key local docs:

- [Protocol Spec](docs/protocol.md)
- [Data Model](docs/data-model.md)
- [Vercel Deployment Guide](docs/deployment-vercel-neon.md)
- [Docker Compose Deployment](docs/deployment-docker-compose.md)
- [Security Model](docs/security.md)
- [AI Agent Instructions](docs/agent-instructions.md)
- [TODO](docs/TODO.md)

Local docs build:

```bash
cd docs
pip install -r requirements.txt
sphinx-build -b html . _build/html
```

## Contributors

- **Nesbitt-bot**: Project author and implementation
- **Trance-0**: Agent guidelines and architectural guidance

## License

MIT


