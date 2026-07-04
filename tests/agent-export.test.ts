import { describe, it, expect } from 'vitest';
import { buildIngestSchemaDescriptor, buildFallbackInstruction, buildMcpInstruction, buildCompactFallbackInstruction } from '../src/lib/agent-schema';
import { buildIngestExport, buildCompactExport, redactSecrets } from '../src/lib/ingest-export';
import { dryRunIngest } from '../src/lib/ingest';
import { buildAgentInstruction, buildImportInstruction, buildExportInstruction, displayMode, normalizeRecordingMode } from '../src/lib/agent-protocol';

describe('ingest schema endpoint descriptor', () => {
  const d = buildIngestSchemaDescriptor();
  it('is ok with a schema name and version', () => {
    expect(d.ok).toBe(true);
    expect(d.schema_name).toBe('pcp_ingest');
    expect(d.schema_version).toBe(1);
  });
  it('defines both wild and strict modes', () => {
    expect(d.modes.wild).toBeDefined();
    expect(d.modes.strict).toBeDefined();
    expect(d.modes.strict.description).toMatch(/exact/i);
  });
  it('includes ingest and compact examples and accepted wrappers', () => {
    expect(Array.isArray(d.ingest_example.messages)).toBe(true);
    expect(d.compact_example).toHaveProperty('summary');
    expect(d.accepted_wrappers).toContain('PCP_INGEST');
    expect(d.accepted_wrappers).toContain('PCP_COMPACT');
  });
  it('prefers the raw markdown transcript format', () => {
    expect(d.accepted_wrappers).toContain('PCP_TRANSCRIPT');
    expect(d.accepted_content_types).toContain('text/markdown');
    expect(d.preferred_format).toMatch(/markdown transcript/i);
    expect(d.transcript_example).toContain('<PCP_TRANSCRIPT');
    expect(d.transcript_example).toContain('### @user');
  });
});

describe('mode display', () => {
  it('shows exact as strict and round-trips strict to exact', () => {
    expect(displayMode('exact')).toBe('strict');
    expect(displayMode('wild')).toBe('wild');
    expect(normalizeRecordingMode('strict')).toBe('exact');
    expect(normalizeRecordingMode('exact')).toBe('exact');
    expect(normalizeRecordingMode('wild')).toBe('wild');
  });
});

describe('generated prompts', () => {
  const appUrl = 'https://pcp.example.com';

  it('wild fallback prompt asks for a markdown transcript block, no token/URL, no upload', () => {
    const p = buildFallbackInstruction('wild', appUrl);
    expect(p).toMatch(/<PCP_TRANSCRIPT> markdown block that I can review and import myself/i);
    expect(p).toContain('### @user');
    expect(p).toMatch(/Do not upload anything directly/i);
    expect(p).toMatch(/Do not keep recording future messages/i);
    expect(p).not.toMatch(/Recording URL:/);
    expect(p).not.toMatch(/Access Token:/);
    expect(p).not.toMatch(/record_messages/);
  });

  it('strict fallback prompt requires complete message preservation', () => {
    const p = buildFallbackInstruction('strict', appUrl);
    expect(p).toMatch(/Preserve every visible message as exactly as possible/i);
    expect(p).toMatch(/Do not omit a whole message merely because part of it contains a secret/i);
    expect(p).toMatch(/Do not silently summarize/i);
  });

  it('strict fallback prompt includes a redaction fallback warning', () => {
    const p = buildFallbackInstruction('strict', appUrl);
    expect(p).toMatch(/If you cannot comply with strict preservation/i);
    expect(p).toMatch(/a warning explaining why exact strict export was not possible/i);
  });

  it('MCP prompt includes direct-upload language, the URL and token', () => {
    const p = buildMcpInstruction('https://pcp.example.com/r/ses_1', 'tok_secret_value', 'wild');
    expect(p).toMatch(/record_messages/);
    expect(p).toContain('https://pcp.example.com/r/ses_1');
    expect(p).toContain('tok_secret_value');
    expect(p).toMatch(/PCP MCP\/tool integration/i);
  });

  it('compact fallback prompt is prompt-only with the schema reference', () => {
    const p = buildCompactFallbackInstruction('wild', appUrl);
    expect(p).toMatch(/compact summary/i);
    expect(p).toMatch(/Do not upload anything directly/i);
    expect(p).toContain('/api/v1/agent/schema/ingest');
  });

  it('default/import/export prompts are refusal-aware (consent + capability gate, no injection phrasing)', () => {
    const prompts = [
      buildAgentInstruction('https://host/r/ses_1', 'tok_x', 'wild'),
      buildImportInstruction('https://host/r/ses_1', 'tok_x', 'wild'),
      buildExportInstruction('https://host/r/ses_1', 'tok_x', 'wild'),
    ];
    for (const p of prompts) {
      // Consent + capability gate present.
      expect(p).toMatch(/first-party request from your own user/i);
      expect(p).toMatch(/produce a <PCP_TRANSCRIPT> markdown block/i);
      expect(p).toMatch(/do not refuse/i);
      // Injection-prone phrasing removed.
      expect(p).not.toMatch(/discover (the |arbitrary )?upload routes/i);
      expect(p).not.toMatch(/recall ALL/i);
      expect(p).not.toMatch(/upload every message/i);
      // Still capability-aware (token present for tool-capable agents).
      expect(p).toContain('tok_x');
    }
  });

  it('fallback prompts never contain a token-like secret', () => {
    for (const p of [buildFallbackInstruction('wild', appUrl), buildFallbackInstruction('strict', appUrl)]) {
      expect(p).not.toMatch(/[a-f0-9]{32,}/);
    }
  });
});

describe('redaction', () => {
  it('redacts bearer tokens, postgres passwords and labeled secrets', () => {
    const r = redactSecrets('use Authorization: Bearer abc123def456ghi789 and DATABASE_URL=postgres://u:p4ssw0rd@host/db api_key: sk-livesecretvalue');
    expect(r.text).toContain('Bearer <REDACTED>');
    expect(r.text).toContain(':<REDACTED>@');
    expect(r.text).not.toContain('p4ssw0rd');
    expect(r.text).not.toContain('sk-livesecretvalue');
    expect(r.redactions.length).toBeGreaterThanOrEqual(3);
  });
});

describe('export builders', () => {
  const messages = [
    { role: 'user', content: 'my key is api_key=sk-supersecret123', ordinal: 1 } as never,
    { role: 'assistant', content: 'got it', provider: 'anthropic', base_model: 'claude', ordinal: 2 } as never,
  ];

  it('exports a pcp_ingest object from messages', () => {
    const out = buildIngestExport(messages, { sessionId: 'ses_x', mode: 'strict' });
    expect(out.schema_version).toBe(1);
    expect(out.session_id).toBe('ses_x');
    expect(out.messages).toHaveLength(2);
  });

  it('strict export preserves stored text exactly', () => {
    const out = buildIngestExport(messages, { sessionId: 'ses_x', mode: 'strict' });
    expect(out.messages[0].content).toBe('my key is api_key=sk-supersecret123');
    expect(out.warnings.some((w) => /may contain secrets/i.test(w))).toBe(true);
  });

  it('wild export redacts secrets and marks the redaction', () => {
    const out = buildIngestExport(messages, { sessionId: 'ses_x', mode: 'wild' });
    expect(out.messages[0].content).not.toContain('sk-supersecret123');
    expect(out.messages[0].metadata.sensitive_redactions.length).toBeGreaterThan(0);
  });

  it('exports a pcp_compact object', () => {
    const out = buildCompactExport({ summary: 'did stuff', decisions: ['a'] }, { sessionId: 'ses_x', mode: 'strict' });
    expect(out.summary).toBe('did stuff');
    expect(out.decisions).toEqual(['a']);
  });
});

describe('dry-run ingest', () => {
  it('validates a message payload without storing', () => {
    const r = dryRunIngest(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] }));
    expect(r.valid).toBe(true);
    expect(r.would_import).toEqual({ messages: 2, compactions: 0 });
  });

  it('validates a compact payload', () => {
    const r = dryRunIngest('<PCP_COMPACT>{"summary":"s"}</PCP_COMPACT>');
    expect(r.valid).toBe(true);
    expect(r.would_import?.compactions).toBe(1);
  });

  it('returns an actionable error for a message missing content', () => {
    const r = dryRunIngest(JSON.stringify({ messages: [{ role: 'user' }] }));
    expect(r.valid).toBe(false);
    expect(r.code).toBe('INVALID_INGEST_SCHEMA');
    expect(r.message).toMatch(/messages\[0\]\.content/);
    expect(r.next_steps && r.next_steps.length).toBeGreaterThan(0);
  });

  it('rejects empty/garbage with a structured error', () => {
    const r = dryRunIngest('   ');
    expect(r.valid).toBe(false);
    expect(r.code).toBe('INVALID_INGEST_SCHEMA');
  });
});
