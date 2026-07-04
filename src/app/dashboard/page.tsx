'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SiteNav } from '@/components/site-nav';
import { NavSidebar } from '@/components/dashboard/nav-sidebar';
import { SessionWorkspace } from '@/components/dashboard/session-workspace';
import { TokenModal } from '@/components/dashboard/token-modal';
import { CreateModal, TopicCreateValues, SessionCreateValues } from '@/components/dashboard/create-modal';
import { EventLog, Message, Session, Topic } from '@/components/dashboard/types';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';
import { buildExportInstruction, buildImportInstruction, buildMinimalInstruction } from '@/lib/agent-protocol';
import { buildMcpInstruction } from '@/lib/agent-schema';
import { DEFAULT_SESSION_TITLE, DEFAULT_TOPIC_TITLE, generateUniqueTitle } from '@/lib/naming';

function getUiToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('ui_token');
}

/**
 * Dashboard content. Wrapped in Suspense so useSearchParams works without
 * blocking SSR. Reads `?session=<id>` from the URL to select a session;
 * clicking a session in the nav pushes `/dashboard?session=<id>` so every
 * session has a shareable URL and the sidebar always stays visible.
 */
function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSessionId = searchParams.get('session') || '';
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState(urlSessionId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingSession, setEditingSession] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTopicId, setEditTopicId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [uiTokenInput, setUiTokenInput] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasUiToken, setHasUiToken] = useState(false);
  const [uiTokenSource, setUiTokenSource] = useState<string | null>(null);
  const [tokenModalSession, setTokenModalSession] = useState<Session | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [createModal, setCreateModal] = useState<{ kind: 'topic' } | { kind: 'session'; topicId: string | null } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const sidebarWidthRef = useRef(320);

  // Restore the saved sidebar width on mount.
  useEffect(() => {
    const saved = Number(localStorage.getItem('pcp_sidebar_w'));
    if (saved >= 220 && saved <= 620) { setSidebarWidth(saved); sidebarWidthRef.current = saved; }
  }, []);

  // Drag the border between the nav sidebar and the workspace.
  function startResize(event: React.MouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startW = sidebarWidthRef.current;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    function onMove(moveEvent: MouseEvent) {
      const next = Math.min(620, Math.max(220, startW + moveEvent.clientX - startX));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
    }
    function onUp() {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try { localStorage.setItem('pcp_sidebar_w', String(sidebarWidthRef.current)); } catch { /* ignore */ }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Sync URL param to state on mount and when URL changes
  useEffect(() => {
    setSelectedSessionId(urlSessionId);
  }, [urlSessionId]);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;
  const selectedTopic = topics.find((topic) => topic.id === selectedSession?.topic_id) || null;

  useEffect(() => {
    setHasUiToken(Boolean(getUiToken()));
    loadAll();
    loadAuthState();
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      loadSessionDetail(selectedSessionId);
    } else {
      setMessages([]);
      setEvents([]);
    }
  }, [selectedSessionId]);

  async function loadAuthState() {
    const uiToken = getUiToken();
    if (!uiToken) return;
    try {
      const res = await fetch('/api/v1/auth/check', { headers: { Authorization: `Bearer ${uiToken}` } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.ui_token_source === 'string') setUiTokenSource(data.ui_token_source);
    } catch { /* advisory only */ }
  }

  function saveUiToken() {
    const token = uiTokenInput.trim();
    if (!token) return;
    localStorage.setItem('ui_token', token);
    setHasUiToken(true);
    setUiTokenInput('');
    setError('');
    loadAll();
    loadAuthState();
  }

  function toggleExpand(groupId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function selectSession(sid: string) {
    setSelectedSessionId(sid);
    router.push(`/dashboard?session=${encodeURIComponent(sid)}`, { scroll: false });
  }

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${getUiToken()}` };
  }

  async function loadAll() {
    setLoading(true);
    try {
      const uiToken = getUiToken();
      if (!uiToken) { setHasUiToken(false); router.replace('/login?next=/dashboard'); return; }
      const [topicsRes, sessionsRes] = await Promise.all([
        fetch('/api/v1/topics', { headers: authHeaders() }),
        fetch('/api/v1/sessions', { headers: authHeaders() }),
      ]);
      const topicsData = await readJsonResponse(topicsRes, { consequence: 'Unable to load topics', moduleProcess: 'topic administration / list topics request', fallbackCause: 'topics endpoint did not return JSON' });
      const sessionsData = await readJsonResponse(sessionsRes, { consequence: 'Unable to load sessions', moduleProcess: 'session administration / list sessions request', fallbackCause: 'sessions endpoint did not return JSON' });
      if (!topicsRes.ok || topicsData.error) { setError(topicsData.error || 'Unable to load topics'); return; }
      if (!sessionsRes.ok || sessionsData.error) { setError(sessionsData.error || 'Unable to load sessions'); return; }
      setTopics(topicsData.topics || []);
      setSessions(sessionsData.sessions || []);
      setError('');
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to load workspace', moduleProcess: 'dashboard / initial data load', cause: `browser could not reach the topics or sessions endpoint; ${errorCause(err)}` }));
    } finally { setLoading(false); }
  }

  async function loadSessionDetail(sessionId: string) {
    try {
      const [reviewRes, eventsRes] = await Promise.all([
        fetch(`/api/v1/sessions/${sessionId}/review`, { headers: authHeaders() }),
        fetch(`/api/v1/sessions/${sessionId}/events`, { headers: authHeaders() }),
      ]);
      const reviewData = await readJsonResponse(reviewRes, { consequence: 'Unable to load messages', moduleProcess: 'session review / message list request', fallbackCause: 'session review endpoint did not return JSON' });
      const eventsData = await readJsonResponse(eventsRes, { consequence: 'Unable to load events', moduleProcess: 'session review / event list request', fallbackCause: 'session events endpoint did not return JSON' });
      if (!reviewRes.ok || reviewData.error) { setError(reviewData.error || 'Unable to load messages'); return; }
      if (!eventsRes.ok || eventsData.error) { setError(eventsData.error || 'Unable to load events'); return; }
      setMessages(reviewData.messages || []);
      setEvents(eventsData.events || []);
      setError('');
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to load session data', moduleProcess: 'session review / load selected session', cause: `browser could not reach session review endpoints; ${errorCause(err)}` }));
    }
  }

  // Open the create dialog (prefilled). The actual POST happens on submit.
  function openCreateTopic() { setCreateModal({ kind: 'topic' }); }
  function openCreateSession(topicId: string | null) { setCreateModal({ kind: 'session', topicId }); }

  async function submitCreateTopic(values: TopicCreateValues) {
    setCreateModal(null);
    try {
      const res = await fetch('/api/v1/topics', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ title: values.title, description: values.description || undefined }) });
      const data = await readJsonResponse(res, { consequence: 'Unable to create topic', moduleProcess: 'topic administration / create topic request', fallbackCause: 'create topic endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || 'Unable to create topic'); return; }
      setExpanded((prev) => new Set(prev).add(data.id));
      setStatus(`Topic created: ${data.title}`);
      await loadAll();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to create topic', moduleProcess: 'topic administration / create topic request', cause: `browser could not reach the topics endpoint; ${errorCause(err)}` })); }
  }

  async function submitCreateSession(values: SessionCreateValues) {
    setCreateModal(null);
    try {
      const res = await fetch('/api/v1/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ title: values.title, topic_id: values.topic_id || undefined, mode: values.mode }) });
      const data = await readJsonResponse(res, { consequence: 'Unable to create session', moduleProcess: 'session administration / create session request', fallbackCause: 'create session endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || 'Unable to create session'); return; }
      setExpanded((prev) => new Set(prev).add(values.topic_id ?? '__none__'));
      selectSession(data.id);
      setStatus(`Session created: ${data.title}`);
      await loadAll();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to create session', moduleProcess: 'session administration / create session request', cause: `browser could not reach the sessions endpoint; ${errorCause(err)}` })); }
  }

  async function renameTopic(topicId: string) {
    const topic = topics.find((item) => item.id === topicId);
    const title = window.prompt('Rename topic', topic?.title || '');
    if (title === null) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`/api/v1/topics/${topicId}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ title: trimmed }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to rename topic'); return; }
      await loadAll();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to rename topic', moduleProcess: 'topic administration / rename topic request', cause: `browser could not reach the rename endpoint; ${errorCause(err)}` })); }
  }

  async function removeTopic(topicId: string) {
    if (!window.confirm('Remove this topic? Its sessions move to Uncategorized.')) return;
    try {
      const orphaned = sessions.filter((session) => session.topic_id === topicId && !session.archived);
      await Promise.all(orphaned.map((session) => fetch(`/api/v1/sessions/${session.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ topic_id: null }) })));
      const res = await fetch(`/api/v1/topics/${topicId}/archive`, { method: 'POST', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to remove topic'); return; }
      setStatus('Topic removed. Its sessions moved to Uncategorized.');
      await loadAll();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to remove topic', moduleProcess: 'topic administration / remove topic request', cause: `browser could not reach the archive endpoint; ${errorCause(err)}` })); }
  }

  async function updateSession(sessionId: string, fields: { title?: string; topic_id?: string | null; archived?: boolean; public?: boolean; mode?: 'wild' | 'exact' }) {
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(fields) });
      const data = await readJsonResponse(res, { consequence: 'Unable to update session', moduleProcess: 'session administration / update session request', fallbackCause: 'update session endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || 'Unable to update session'); return false; }
      await loadAll();
      return true;
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to update session', moduleProcess: 'session administration / update session request', cause: `browser could not reach the session endpoint; ${errorCause(err)}` })); return false; }
  }

  async function removeSession(sessionId: string) {
    if (!window.confirm('Move this session to trash?')) return;
    const ok = await updateSession(sessionId, { archived: true });
    if (ok && selectedSessionId === sessionId) { setSelectedSessionId(''); router.push('/dashboard', { scroll: false }); }
    if (ok) setStatus('Session moved to trash.');
  }

  async function restoreSession(sessionId: string) {
    if (await updateSession(sessionId, { archived: false })) setStatus('Session restored.');
  }

  async function deleteSession(sessionId: string) {
    const session = sessions.find((s) => s.id === sessionId);
    if (!window.confirm(`Permanently delete "${session?.title || 'session'}" and all its messages? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to delete session permanently'); return; }
      if (selectedSessionId === sessionId) { setSelectedSessionId(''); router.push('/dashboard', { scroll: false }); }
      setStatus('Session permanently deleted.');
      await loadAll();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to delete session', moduleProcess: 'session administration / permanent delete', cause: errorCause(err) })); }
  }

  async function restoreTopic(topicId: string) {
    try {
      const res = await fetch(`/api/v1/topics/${topicId}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ archived: false }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to restore topic'); return; }
      setStatus('Topic restored.');
      await loadAll();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to restore topic', moduleProcess: 'topic administration / restore', cause: errorCause(err) })); }
  }

  async function deleteTopic(topicId: string) {
    const topic = topics.find((t) => t.id === topicId);
    if (!window.confirm(`Permanently delete "${topic?.title || 'topic'}"? Its sessions will move to Uncategorized.`)) return;
    try {
      const res = await fetch(`/api/v1/topics/${topicId}/archive`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to delete topic'); return; }
      setStatus('Topic permanently deleted.');
      await loadAll();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to delete topic', moduleProcess: 'topic administration / permanent delete', cause: errorCause(err) })); }
  }

  async function emptyTrash() {
    if (!window.confirm('Permanently delete ALL archived sessions and topics? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/v1/trash/empty', { method: 'POST', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to empty trash'); return; }
      setStatus(`Trash emptied: ${data.sessions_deleted} sessions, ${data.topics_deleted} topics deleted.`);
      await loadAll();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to empty trash', moduleProcess: 'trash administration / empty trash', cause: errorCause(err) })); }
  }

  async function moveSession(sessionId: string, topicId: string | null) {
    if (await updateSession(sessionId, { topic_id: topicId })) {
      setExpanded((prev) => new Set(prev).add(topicId ?? '__none__'));
      setStatus('Session moved.');
    }
  }

  function startEditSession() { if (!selectedSession) return; setEditTitle(selectedSession.title); setEditTopicId(selectedSession.topic_id || ''); setEditingSession(true); }
  async function saveSessionEdits() { const title = editTitle.trim(); if (!selectedSession || !title) return; if (await updateSession(selectedSession.id, { title, topic_id: editTopicId || null })) { setEditingSession(false); setStatus('Session updated'); } }
  async function archiveSelectedSession() { if (!selectedSession) return; if (await updateSession(selectedSession.id, { archived: true })) setStatus('Session archived'); }
  async function togglePublic(session: Session, next: boolean) { if (await updateSession(session.id, { public: next })) setStatus(next ? 'Session is now public (read-only link).' : 'Session is now private.'); }
  async function setMode(session: Session, mode: 'wild' | 'exact') { if (await updateSession(session.id, { mode })) setStatus(mode === 'exact' ? 'Recording mode: exact — agents are told to record verbatim.' : 'Recording mode: wild — agents may redact secrets.'); }
  async function restoreSelectedSession() { if (!selectedSession) return; if (await updateSession(selectedSession.id, { archived: false })) setStatus('Session restored'); }

  async function generateToken(session: Session) {
    try {
      const res = await fetch(`/api/v1/sessions/${session.id}/tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ expires_in: '7d' }) });
      const data = await readJsonResponse(res, { consequence: 'Unable to create token', moduleProcess: 'session token administration / create token request', fallbackCause: 'create token endpoint did not return JSON' });
      if (!res.ok || data.error || !data.access_token) { setError(data.error || 'Unable to create token'); return; }
      const url = `${window.location.origin}/r/${session.id}`;
      const instruction = buildMinimalInstruction(url, data.access_token);
      setGeneratedToken(instruction);
      setStatus('Recording URL + access token created (minimal prompt — the URL carries the full instructions). Copy now; the token will not be shown again.');
      await navigator.clipboard.writeText(instruction).catch(() => undefined);
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to create token', moduleProcess: 'session token administration / create token request', cause: `browser could not reach the token endpoint; ${errorCause(err)}` })); }
  }

  async function createImportToken(session: Session) {
    try {
      const res = await fetch(`/api/v1/sessions/${session.id}/tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ expires_in: '7d' }) });
      const data = await readJsonResponse(res, { consequence: 'Unable to create token', moduleProcess: 'session token administration / create import token request', fallbackCause: 'create token endpoint did not return JSON' });
      if (!res.ok || data.error || !data.access_token) { setError(data.error || 'Unable to create import token'); return; }
      const url = `${window.location.origin}/r/${session.id}`;
      const instruction = data.import_instruction || buildImportInstruction(url, data.access_token, session.mode || 'wild');
      setGeneratedToken(instruction);
      setStatus('Import token created. Agent will recall its past history and upload to PCP.');
      await navigator.clipboard.writeText(instruction).catch(() => undefined);
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to create import token', moduleProcess: 'session token administration / create import token', cause: errorCause(err) })); }
  }

  async function copyMcpPrompt(session: Session) {
    try {
      const res = await fetch(`/api/v1/sessions/${session.id}/tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ expires_in: '7d' }) });
      const data = await readJsonResponse(res, { consequence: 'Unable to create token', moduleProcess: 'session token administration / create MCP token request', fallbackCause: 'create token endpoint did not return JSON' });
      if (!res.ok || data.error || !data.access_token) { setError(data.error || 'Unable to create MCP token'); return; }
      const url = `${window.location.origin}/r/${session.id}`;
      const instruction = buildMcpInstruction(url, data.access_token, (session.mode as 'wild' | 'exact') || 'wild');
      setGeneratedToken(instruction);
      setStatus('MCP/tool prompt created (contains the one-time token). For agents with an installed PCP tool.');
      await navigator.clipboard.writeText(instruction).catch(() => undefined);
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to create MCP token', moduleProcess: 'session token administration / create MCP token', cause: errorCause(err) })); }
  }

  async function createExportToken(session: Session) {
    try {
      const res = await fetch(`/api/v1/sessions/${session.id}/tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ expires_in: '7d' }) });
      const data = await readJsonResponse(res, { consequence: 'Unable to create token', moduleProcess: 'session token administration / create export token request', fallbackCause: 'create token endpoint did not return JSON' });
      if (!res.ok || data.error || !data.access_token) { setError(data.error || 'Unable to create export token'); return; }
      const url = `${window.location.origin}/r/${session.id}`;
      const instruction = data.export_instruction || buildExportInstruction(url, data.access_token, session.mode || 'wild');
      setGeneratedToken(instruction);
      setStatus('Export token created. Agent will read PCP history and record all new context.');
      await navigator.clipboard.writeText(instruction).catch(() => undefined);
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to create export token', moduleProcess: 'session token administration / create export token', cause: errorCause(err) })); }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <SiteNav />
      {uiTokenSource === 'deploy' && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="mx-auto flex max-w-7xl items-start gap-2">
            <span>
              You are signed in with a <strong>deploy-generated</strong> admin token. A fresh token is generated on every deploy. Set your own in{' '}
              <Link href="/settings" className="font-medium underline">Settings</Link>, or define <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">PCP_ADMIN_TOKEN</code> and redeploy.
            </span>
          </div>
        </div>
      )}
      <div
        className="grid h-[calc(100vh-57px)] grid-cols-1 overflow-hidden lg:grid-cols-[var(--pcp-sidebar-w)_6px_minmax(0,1fr)]"
        style={{ ['--pcp-sidebar-w' as string]: `${sidebarWidth}px` } as React.CSSProperties}
      >
        <NavSidebar
          topics={topics} sessions={sessions} loading={loading}
          selectedSessionId={selectedSessionId} expanded={expanded}
          query={query} showArchived={showArchived}
          onToggleExpand={toggleExpand} onQueryChange={setQuery}
          onShowArchivedChange={setShowArchived}
          onSelectSession={selectSession} onCreateSession={openCreateSession}
          onCreateTopic={openCreateTopic} onRefresh={loadAll}
          onRenameTopic={renameTopic} onRemoveTopic={removeTopic}
          onRestoreTopic={restoreTopic} onDeleteTopic={deleteTopic}
          onRemoveSession={removeSession} onRestoreSession={restoreSession}
          onDeleteSession={deleteSession} onEmptyTrash={emptyTrash}
          onMoveSession={moveSession}
        />
        {/* Drag handle to resize the sidebar / message panel split (desktop only) */}
        <div
          className="group hidden cursor-col-resize items-center justify-center border-x border-transparent bg-slate-100 hover:bg-sky-200 dark:bg-slate-800 dark:hover:bg-sky-800 lg:flex"
          onMouseDown={startResize}
          title="Drag to resize"
          role="separator"
          aria-orientation="vertical"
        >
          <div className="h-8 w-0.5 rounded bg-slate-300 group-hover:bg-sky-500 dark:bg-slate-600" />
        </div>
        <SessionWorkspace
          error={error} status={status} hasUiToken={hasUiToken} uiTokenInput={uiTokenInput}
          selectedTopic={selectedTopic} selectedSession={selectedSession}
          topics={topics.filter(t => !t.archived)} messages={messages} events={events}
          eventsOpen={eventsOpen} onToggleEvents={() => setEventsOpen(o => !o)}
          editingSession={editingSession} editTitle={editTitle} editTopicId={editTopicId}
          generatedToken={generatedToken} onClearGeneratedToken={() => setGeneratedToken('')}
          onUiTokenInputChange={setUiTokenInput} onSaveUiToken={saveUiToken}
          onStartEditSession={startEditSession} onEditTitleChange={setEditTitle}
          onEditTopicIdChange={setEditTopicId} onSaveSessionEdits={saveSessionEdits}
          onCancelSessionEdits={() => setEditingSession(false)}
          onArchiveSelectedSession={archiveSelectedSession} onRestoreSelectedSession={restoreSelectedSession}
          onGenerateToken={generateToken} onCreateImportToken={createImportToken} onCreateExportToken={createExportToken} onManageTokens={setTokenModalSession}
          onTogglePublic={togglePublic} onSetMode={setMode} onCopyMcpPrompt={copyMcpPrompt}
          onImported={() => selectedSession && loadSessionDetail(selectedSession.id)}
        />
      </div>
      {tokenModalSession && <TokenModal sessionId={tokenModalSession.id} sessionTitle={tokenModalSession.title} onClose={() => setTokenModalSession(null)} />}
      {createModal?.kind === 'topic' && (
        <CreateModal
          kind="topic"
          defaultTitle={generateUniqueTitle(DEFAULT_TOPIC_TITLE, topics.map((t) => t.title))}
          onCancel={() => setCreateModal(null)}
          onCreateTopic={submitCreateTopic}
        />
      )}
      {createModal?.kind === 'session' && (
        <CreateModal
          kind="session"
          defaultTitle={generateUniqueTitle(
            DEFAULT_SESSION_TITLE,
            sessions.filter((s) => (s.topic_id ?? null) === createModal.topicId).map((s) => s.title),
          )}
          topics={topics.filter((t) => !t.archived)}
          defaultTopicId={createModal.topicId}
          onCancel={() => setCreateModal(null)}
          onCreateSession={submitCreateSession}
        />
      )}
    </main>
  );
}

/** Suspense wrapper required by Next.js for useSearchParams in App Router. */
export default function Dashboard() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading dashboard...</main>}>
      <DashboardContent />
    </Suspense>
  );
}
