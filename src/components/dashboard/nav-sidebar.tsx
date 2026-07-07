'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Folder, FolderPlus, Inbox, MessageSquare, Plus, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Session, Topic } from './types';
import { ContextMenu, ContextMenuItem } from './context-menu';

export const UNCATEGORIZED = '__none__';
export const TRASH_GROUP = '__trash__';

interface NavSidebarProps {
  topics: Topic[];
  sessions: Session[];
  loading: boolean;
  selectedSessionId: string;
  expanded: Set<string>;
  query: string;
  showArchived: boolean;
  onToggleExpand: (groupId: string) => void;
  onQueryChange: (query: string) => void;
  onShowArchivedChange: (showArchived: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (topicId: string | null) => void;
  onCreateTopic: () => void;
  onRefresh: () => void;
  onRenameTopic: (topicId: string) => void;
  onRemoveTopic: (topicId: string) => void;
  onRestoreTopic: (topicId: string) => void;
  onDeleteTopic: (topicId: string) => void;
  onRemoveSession: (sessionId: string) => void;
  onRestoreSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onEmptyTrash: () => void;
  onMoveSession: (sessionId: string, topicId: string | null) => void;
}

interface MenuState { x: number; y: number; items: ContextMenuItem[]; }

export function NavSidebar({
  topics, sessions, loading, selectedSessionId, expanded, query, showArchived,
  onToggleExpand, onQueryChange, onShowArchivedChange, onSelectSession,
  onCreateSession, onCreateTopic, onRefresh, onRenameTopic, onRemoveTopic,
  onRestoreTopic, onDeleteTopic, onRemoveSession, onRestoreSession, onDeleteSession,
  onEmptyTrash, onMoveSession,
}: NavSidebarProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Key of the group currently under the drag cursor (for the drop highlight).
  const [dropKey, setDropKey] = useState<string | null>(null);
  // One-shot "expand on hover" timer, plus a live mirror of `expanded` so the
  // deferred callback never toggles a group that opened in the meantime.
  const expandTimer = useRef<{ key: string; handle: ReturnType<typeof setTimeout> } | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  function cancelExpand() {
    if (expandTimer.current) { clearTimeout(expandTimer.current.handle); expandTimer.current = null; }
  }

  // Auto-expand a collapsed group after a short hover, exactly once — never on
  // every dragover event (that was the source of the open/close jitter).
  function scheduleExpand(key: string) {
    if (expandedRef.current.has(key)) return;
    if (expandTimer.current?.key === key) return;
    cancelExpand();
    const handle = setTimeout(() => {
      expandTimer.current = null;
      if (!expandedRef.current.has(key)) onToggleExpand(key);
    }, 550);
    expandTimer.current = { key, handle };
  }

  // Cancel any pending expand when the drag session ends anywhere.
  useEffect(() => cancelExpand, []);

  const visibleSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (!q) return true;
      return s.title.toLowerCase().includes(q);
    });
  }, [sessions, query]);

  // Active (non-archived) topics only; archived ones go to Trash.
  const activeTopics = useMemo(() => topics.filter((t) => !t.archived), [topics]);
  const archivedTopics = useMemo(() => topics.filter((t) => t.archived), [topics]);

  const byTopic = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of visibleSessions) map.set(s.topic_id ?? UNCATEGORIZED, [...(map.get(s.topic_id ?? UNCATEGORIZED) || []), s]);
    return map;
  }, [visibleSessions]);

  const activeSessions = useMemo(() => visibleSessions.filter((s) => !s.archived), [visibleSessions]);
  const archivedSessions = useMemo(() => visibleSessions.filter((s) => s.archived), [visibleSessions]);
  const uncategorizedActive = useMemo(() => activeSessions.filter((s) => !s.topic_id), [activeSessions]);
  // Under each active topic, only show non-archived sessions. Archived ones go to Trash.
  const byTopicActive = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of activeSessions) {
      if (s.topic_id) map.set(s.topic_id, [...(map.get(s.topic_id) || []), s]);
    }
    return map;
  }, [activeSessions]);

  function pressHandlers(items: ContextMenuItem[]) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    return {
      onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, items }); },
      onTouchStart: (event: React.TouchEvent) => { const touch = event.touches[0]; timer = setTimeout(() => setMenu({ x: touch.clientX, y: touch.clientY, items }), 500); },
      onTouchEnd: clear, onTouchMove: clear,
    };
  }

  function sessionItems(s: Session): ContextMenuItem[] {
    if (s.archived) {
      return [
        { label: 'Restore', onClick: () => onRestoreSession(s.id) },
        { label: 'Delete permanently', danger: true, onClick: () => onDeleteSession(s.id) },
      ];
    }
    return [{ label: 'Move to trash', danger: true, onClick: () => onRemoveSession(s.id) }];
  }

  function topicItems(t: Topic): ContextMenuItem[] {
    if (t.archived) {
      return [
        { label: 'Restore', onClick: () => onRestoreTopic(t.id) },
        { label: 'Delete permanently', danger: true, onClick: () => onDeleteTopic(t.id) },
      ];
    }
    return [
      { label: 'Rename', onClick: () => onRenameTopic(t.id) },
      { label: 'New session here', onClick: () => onCreateSession(t.id) },
      { label: 'Move to trash', danger: true, onClick: () => onRemoveTopic(t.id) },
    ];
  }

  // Drag-and-drop: session → topic.
  function dragStart(sessionId: string) { setDragId(sessionId); }
  function dragEnd() { setDragId(null); setDropKey(null); cancelExpand(); }

  /**
   * Drop-target handlers for a group. `key` identifies the group (for the
   * highlight + hover-expand); `topicId` is where a dropped session lands
   * (null = uncategorized). onDragOver only sets state when it actually
   * changes, so hovering no longer thrashes the folder open/closed.
   */
  function dropTarget(key: string, topicId: string | null) {
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        setDropKey((prev) => (prev === key ? prev : key));
        scheduleExpand(key);
      },
      onDragLeave: (e: React.DragEvent) => {
        // Ignore leaves into descendant elements; only react to leaving the group.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropKey((prev) => (prev === key ? null : prev));
        cancelExpand();
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        cancelExpand();
        if (dragId) onMoveSession(dragId, topicId);
        setDragId(null);
        setDropKey(null);
      },
    };
  }

  function renderSession(s: Session) {
    return (
      <button
        key={s.id}
        draggable={!s.archived}
        onDragStart={() => dragStart(s.id)}
        onDragEnd={dragEnd}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
          selectedSessionId === s.id ? 'bg-slate-950 text-white hover:bg-slate-900 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300' : 'text-slate-700 dark:text-slate-300'
        } ${s.archived ? 'opacity-60' : ''}`}
        onClick={() => onSelectSession(s.id)}
        type="button"
        {...pressHandlers(sessionItems(s))}
      >
        <MessageSquare size={15} className="shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate">{s.title}</span>
      </button>
    );
  }

  function renderGroup(key: string, label: string, icon: React.ReactNode, groupSessions: Session[], menuItems?: ContextMenuItem[], isDropTarget = true) {
    const isOpen = expanded.has(key);
    const targetTopicId = key === UNCATEGORIZED || key === TRASH_GROUP ? null : key;
    const dropProps = isDropTarget ? dropTarget(key, targetTopicId) : {};
    const isDropActive = isDropTarget && dragId !== null && dropKey === key;
    return (
      <div
        key={key}
        className={`mb-1 rounded-md ${isDropActive ? 'ring-2 ring-inset ring-sky-400 bg-sky-50 dark:bg-sky-950/40' : ''}`}
        {...dropProps}
      >
        <button
          className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={() => onToggleExpand(key)}
          type="button"
          {...(menuItems ? pressHandlers(menuItems) : {})}
        >
          <ChevronRight size={15} className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 group-hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400">{groupSessions.length}</span>
        </button>
        {isOpen && (
          <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2 dark:border-slate-800">
            {groupSessions.length === 0 ? <p className="px-2 py-1.5 text-xs text-slate-400">No sessions</p> : groupSessions.map(renderSession)}
          </div>
        )}
      </div>
    );
  }

  const hasTrash = archivedSessions.length > 0 || archivedTopics.length > 0;

  return (
    <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-950/90 lg:border-b-0 lg:border-r">
      <div className="mb-3 flex items-center gap-2">
        <button className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300" onClick={() => onCreateSession(null)} type="button"><Plus size={16} /> New session</button>
        <button className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" onClick={onCreateTopic} title="New topic" type="button"><FolderPlus size={17} /></button>
        <button className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" onClick={onRefresh} title="Refresh" type="button"><RefreshCw size={16} /></button>
      </div>

      <div className="mb-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900">
        <Search size={15} className="text-slate-400" />
        <input className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100" value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Search sessions" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">Loading...</div>
        ) : (
          <>
            {renderGroup(UNCATEGORIZED, 'Uncategorized', <Inbox size={15} className="shrink-0 opacity-70" />, uncategorizedActive)}
            {activeTopics.map((t) => renderGroup(t.id, t.title, <Folder size={15} className="shrink-0 opacity-70" />, byTopicActive.get(t.id) || [], topicItems(t)))}
            {activeTopics.length === 0 && uncategorizedActive.length === 0 && activeSessions.length === 0 && (
              <div className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">Start a new session or topic.</div>
            )}
          </>
        )}
      </div>

      {/* Trash section */}
      {hasTrash && (
        <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-800">
          {renderGroup(TRASH_GROUP, 'Trash', <Trash2 size={15} className="shrink-0 opacity-70" />, archivedSessions, [
            archivedTopics.length > 0 && { label: `Empty trash (${archivedSessions.length} sessions, ${archivedTopics.length} topics)`, danger: true, onClick: onEmptyTrash },
          ].filter(Boolean) as ContextMenuItem[], false)}
          {archivedTopics.map((t) => {
            const isOpen = expanded.has(t.id);
            return (
              <div key={t.id} className="mb-1 ml-3">
                <button className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" onClick={() => onToggleExpand(t.id)} type="button" {...pressHandlers(topicItems(t))}>
                  <ChevronRight size={15} className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <Folder size={15} className="shrink-0 opacity-50" />
                  <span className="min-w-0 flex-1 truncate line-through">{t.title}</span>
                </button>
                {isOpen && <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2 dark:border-slate-800">{(byTopic.get(t.id) || []).map(renderSession)}</div>}
              </div>
            );
          })}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}
