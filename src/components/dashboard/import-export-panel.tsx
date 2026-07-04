'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Download, FileJson, Clipboard, ShieldAlert, Shield } from 'lucide-react';
import { Message } from './types';
import { buildIngestExport, buildCompactExport, redactSecrets, ExportCompaction } from '@/lib/ingest-export';
import { buildFallbackInstruction } from '@/lib/agent-schema';
import { messagesToTranscript, TRANSCRIPT_VERSION } from '@/lib/agent-markdown';
import { displayMode, RecordingMode } from '@/lib/agent-protocol';

interface ImportExportPanelProps {
  sessionId: string;
  sessionTitle: string;
  mode: RecordingMode;
  messages: Message[];
  /** Creates a token and shows the MCP/tool instruction (includes the token). */
  onCopyMcpPrompt: () => void;
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Canonical `<PCP_TRANSCRIPT>` markdown export. Round-trippable: pasting this
 * into another session's Import box (or POSTing it to ingest) reproduces the
 * messages, so this is the human-readable cross-device sync artifact.
 */
function toTranscript(messages: Message[], title: string, mode: 'wild' | 'strict'): string {
  const exported = mode === 'wild'
    ? messages.map((m) => ({ ...m, content: redactSecrets(m.content).text }))
    : messages;
  return [
    `# ${title}`,
    '',
    `<PCP_TRANSCRIPT v=${TRANSCRIPT_VERSION} mode=${mode}>`,
    messagesToTranscript(exported),
    '</PCP_TRANSCRIPT>',
    '',
  ].join('\n');
}

/**
 * Admin Import / Export panel. Exports recorded messages/compactions as PCP
 * fallback JSON (wild redacts secrets, strict reproduces stored text exactly)
 * and copies the wild/strict/MCP agent prompts. Collapsed by default.
 */
export function ImportExportPanel({ sessionId, sessionTitle, mode, messages, onCopyMcpPrompt }: ImportExportPanelProps) {
  const [open, setOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'wild' | 'strict'>(displayMode(mode));
  const [compactions, setCompactions] = useState<ExportCompaction[]>([]);
  const [copied, setCopied] = useState('');

  useEffect(() => { setExportMode(displayMode(mode)); }, [mode, sessionId]);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/v1/sessions/${sessionId}/compactions`, { headers: { Authorization: `Bearer ${localStorage.getItem('ui_token')}` } })
      .then((r) => r.json()).then((d) => setCompactions(d.compactions || [])).catch(() => setCompactions([]));
  }, [open, sessionId]);

  function flash(label: string) { setCopied(label); window.setTimeout(() => setCopied(''), 1500); }
  function copy(text: string, label: string) { navigator.clipboard.writeText(text).catch(() => undefined); flash(label); }

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const ingestJson = () => `<PCP_INGEST>\n${JSON.stringify(buildIngestExport(messages, { sessionId, mode: exportMode, suggestedTitle: sessionTitle }), null, 2)}\n</PCP_INGEST>`;
  const compactJson = () => {
    const compaction = compactions[0] || { summary: '' };
    return `<PCP_COMPACT>\n${JSON.stringify(buildCompactExport(compaction, { sessionId, mode: exportMode, suggestedTitle: sessionTitle }), null, 2)}\n</PCP_COMPACT>`;
  };

  const btn = 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';

  return (
    <section className="mt-5 rounded-md border border-slate-200 dark:border-slate-800">
      <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-slate-700 dark:text-slate-200" onClick={() => setOpen((o) => !o)} type="button">
        <ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        <FileJson size={16} className="text-sky-600 dark:text-sky-300" />
        Import / Export
        <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${displayMode(mode) === 'strict' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'}`}>
          {displayMode(mode) === 'strict' ? <><ShieldAlert size={12} /> Mode: strict — exact preservation</> : <><Shield size={12} /> Mode: wild — redaction allowed</>}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Export as:</span>
            <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
              <button className={`rounded px-2 py-1 ${exportMode === 'wild' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300'}`} onClick={() => setExportMode('wild')} type="button" title="Redact secrets matching known patterns">Wild</button>
              <button className={`rounded px-2 py-1 ${exportMode === 'strict' ? 'bg-amber-600 text-white' : 'text-slate-600 dark:text-slate-300'}`} onClick={() => setExportMode('strict')} type="button" title="Reproduce stored text exactly (may contain secrets)">Strict</button>
            </div>
            {exportMode === 'strict' && <span className="text-amber-600 dark:text-amber-400">Strict export may contain secrets if the session stored them.</span>}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Export JSON ({messages.length} messages, {compactions.length} compactions)</p>
            <div className="flex flex-wrap gap-2">
              <button className={btn} onClick={() => copy(toTranscript(messages, sessionTitle, exportMode), 'transcript')} type="button" title="Human-readable markdown transcript; paste into another session's Import box to sync"><Clipboard size={13} /> {copied === 'transcript' ? 'Copied' : 'Copy transcript (.md)'}</button>
              <button className={btn} onClick={() => download(`pcp-session-${sessionId}.md`, toTranscript(messages, sessionTitle, exportMode), 'text/markdown')} type="button"><Download size={13} /> Download .md</button>
              <button className={btn} onClick={() => copy(ingestJson(), 'ingest')} type="button"><Clipboard size={13} /> {copied === 'ingest' ? 'Copied' : 'Copy PCP_INGEST'}</button>
              <button className={btn} onClick={() => download(`pcp-ingest-${sessionId}.json`, ingestJson(), 'application/json')} type="button"><Download size={13} /> Download .json</button>
              <button className={btn} onClick={() => copy(compactJson(), 'compact')} type="button"><Clipboard size={13} /> {copied === 'compact' ? 'Copied' : 'Copy PCP_COMPACT'}</button>
              <button className={btn} onClick={() => download(`pcp-compact-${sessionId}.json`, compactJson(), 'application/json')} type="button"><Download size={13} /> Download compact .json</button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Agent prompts</p>
            <div className="flex flex-wrap gap-2">
              <button className={btn} onClick={() => copy(buildFallbackInstruction('wild', appUrl), 'wild')} type="button" title="Copy-paste fallback: agent produces sanitized JSON you import yourself (no upload)"><Clipboard size={13} /> {copied === 'wild' ? 'Copied' : 'Copy prompt: Wild'}</button>
              <button className={btn} onClick={() => copy(buildFallbackInstruction('strict', appUrl), 'strict')} type="button" title="Copy-paste fallback: exact preservation requested (no upload)"><Clipboard size={13} /> {copied === 'strict' ? 'Copied' : 'Copy prompt: Strict'}</button>
              <button className={btn} onClick={onCopyMcpPrompt} type="button" title="For agents with a PCP MCP/tool integration: direct upload using the token"><Clipboard size={13} /> Copy prompt: MCP/tool</button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Use <strong>Wild/Strict</strong> for agents that cannot or will not upload — they return JSON you paste into the Import box below. Use <strong>MCP/tool</strong> only for agents with an installed PCP tool that can POST directly.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
