import { describe, it, expect } from 'vitest';
import {
  buildInstructionMarkdown,
  buildTranscriptDocument,
  escapeTranscriptContent,
  messagesToTranscript,
  transcriptExampleText,
} from '../src/lib/agent-markdown';
import { buildMinimalInstruction } from '../src/lib/agent-protocol';
import { parseIngestPayload, parseTranscript } from '../src/lib/ingest';

describe('canonical markdown transcript', () => {
  it('renders messages as ### @role sections', () => {
    const md = messagesToTranscript([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi\nthere' },
    ]);
    expect(md).toBe('### @user\n\nhello\n\n### @assistant\n\nhi\nthere');
  });

  it('parses ### @role sections back into messages', () => {
    const result = parseIngestPayload('### @user\n\nhello\n\n### @assistant\n\nhi\nthere');
    expect(result).toEqual({
      kind: 'messages',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi\nthere' },
      ],
    });
  });

  it('round-trips content containing heading-like and Role:-like lines', () => {
    const tricky = 'Try this:\n### @user is a heading marker\nUser: not a new message\ncode `### @assistant`';
    const md = messagesToTranscript([
      { role: 'user', content: tricky },
      { role: 'assistant', content: 'ok' },
    ]);
    const parsed = parseTranscript(md);
    expect(parsed).toEqual([
      { role: 'user', content: tricky },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('escapes only heading-like lines', () => {
    expect(escapeTranscriptContent('plain line')).toBe('plain line');
    expect(escapeTranscriptContent('### @user')).toBe('\\### @user');
    expect(escapeTranscriptContent('\\### @user')).toBe('\\\\### @user');
  });

  it('accepts a <PCP_TRANSCRIPT> block with attributes', () => {
    const block = '<PCP_TRANSCRIPT v=1 mode=wild>\n### @user\n\nq\n\n### @assistant\n\na\n</PCP_TRANSCRIPT>';
    const result = parseIngestPayload(block);
    expect(result).toEqual({
      kind: 'messages',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ],
    });
  });

  it('recovers an unclosed <PCP_TRANSCRIPT> block', () => {
    const result = parseIngestPayload('<PCP_TRANSCRIPT v=1>\n### @user\n\nq');
    expect(result).toEqual({ kind: 'messages', messages: [{ role: 'user', content: 'q' }] });
  });

  it('ignores prose before the first heading (agent preambles)', () => {
    const result = parseIngestPayload('Here is the transcript you asked for:\n\n### @user\n\nq');
    expect(result).toEqual({ kind: 'messages', messages: [{ role: 'user', content: 'q' }] });
  });

  it('round-trips the export-panel wrapper (title + tag)', () => {
    const doc = `# My session\n\n<PCP_TRANSCRIPT v=1 mode=strict>\n${messagesToTranscript([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ])}\n</PCP_TRANSCRIPT>\n`;
    const result = parseIngestPayload(doc);
    expect(result.kind).toBe('messages');
    if (result.kind === 'messages') expect(result.messages).toHaveLength(2);
  });

  it('maps role aliases in headings', () => {
    const parsed = parseTranscript('### @human\n\nq\n\n### @ai\n\na');
    expect(parsed.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('transcript read-back document', () => {
  it('wraps messages with a header and machine comment', () => {
    const doc = buildTranscriptDocument({
      sessionId: 'ses_1',
      title: 'My work',
      mode: 'wild',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(doc).toContain('# PCP transcript — My work');
    expect(doc).toContain('session: ses_1');
    expect(doc).toContain('### @user');
    // The document body itself must be re-importable.
    const parsed = parseIngestPayload(doc);
    expect(parsed.kind).toBe('messages');
  });

  it('handles an empty session', () => {
    const doc = buildTranscriptDocument({ sessionId: 'ses_1', title: null, mode: 'exact', messages: [] });
    expect(doc).toContain('No messages recorded yet');
  });
});

describe('recording-URL instruction document', () => {
  const doc = buildInstructionMarkdown({
    base: 'https://pcp.example.com',
    sessionId: 'ses_1',
    mode: 'wild',
    existingMessageCount: 3,
  });

  it('is self-contained: consent framing, routes, transcript format, limits', () => {
    expect(doc).toMatch(/first-party request from your own user/i);
    expect(doc).toMatch(/scoped to \*\*this one session only\*\*/i);
    expect(doc).toContain('https://pcp.example.com/api/v1/agent/sessions/ses_1/ingest');
    expect(doc).toContain('https://pcp.example.com/r/ses_1/transcript');
    expect(doc).toContain('### @user');
    expect(doc).toMatch(/text\/markdown/);
    expect(doc).toMatch(/max/i);
  });

  it('never contains a token and never asks the agent to echo one', () => {
    expect(doc).toContain('<access-token>');
    expect(doc).not.toMatch(/[a-f0-9]{32,}/);
    expect(doc).toMatch(/Never print, log, or record the access token/i);
  });

  it('tells the agent about existing history', () => {
    expect(doc).toContain('**3 message(s)**');
  });

  it('offers the offline paste-back block as a good outcome', () => {
    expect(doc).toContain('<PCP_TRANSCRIPT');
    expect(doc).toMatch(/good outcome, not a failure/i);
  });
});

describe('minimal URL + token prompt', () => {
  const p = buildMinimalInstruction('https://pcp.example.com/r/ses_1', 'tok_secret');

  it('contains only the URL, the token, and consent framing', () => {
    expect(p).toContain('https://pcp.example.com/r/ses_1');
    expect(p).toContain('tok_secret');
    expect(p).toMatch(/first-party request/i);
    expect(p).toMatch(/self-hosted/i);
  });

  it('is short and defers details to the recording URL', () => {
    expect(p.split('\n').length).toBeLessThan(15);
    expect(p).toMatch(/human-readable instructions/i);
  });

  it('offers a non-refusal path for offline agents', () => {
    expect(p).toMatch(/cannot make web requests/i);
    expect(p).toMatch(/offline instructions/i);
  });
});

describe('transcript example', () => {
  it('is itself parseable', () => {
    const result = parseIngestPayload(transcriptExampleText());
    expect(result.kind).toBe('messages');
    if (result.kind === 'messages') {
      expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    }
  });
});
