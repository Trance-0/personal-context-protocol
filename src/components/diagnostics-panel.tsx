'use client';

/**
 * What this deployment is, and what it has been doing.
 *
 * Both questions were previously answerable only by probing the API by hand.
 * That matters more than it sounds: a deployment can be healthy, authenticate,
 * serve its data, and still be missing an entire feature line because it was
 * built from a branch that never received it — from the outside that looks
 * identical to a bug, because the routes just 404.
 *
 * So this states the build, the database, the environment, which features are
 * actually present, and the recent activity, in one place.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';

type Feature = {
  id: string;
  label: string;
  migration: string;
  routes: string[];
  description: string;
  present: boolean;
};

type ConfigIssue = { key: string; severity: string; problem: string };

type Diagnostics = {
  build: { version: string; commit: string | null; branch: string | null; runtime: string; environment: string };
  database: { ok: boolean; latencyMs: number | null; error: string | null };
  counts: Record<string, number> | null;
  migrations: Array<{ version: string; appliedAt: string | null }>;
  config: ConfigIssue[];
  features: Feature[];
};

type EventRow = {
  id: string;
  action: string;
  actor: string;
  session_id: string | null;
  session_title: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

const CARD = 'rounded-md border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900';
const LABEL = 'text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

export function DiagnosticsPanel({ token }: { token: string }) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [diagRes, eventRes] = await Promise.all([
        fetch('/api/v1/diagnostics', { headers }),
        fetch('/api/v1/events?limit=50', { headers }),
      ]);

      const diag = await readJsonResponse(diagRes, {
        consequence: 'Unable to read diagnostics',
        moduleProcess: 'settings / diagnostics request',
        fallbackCause: 'the diagnostics endpoint did not return JSON',
      });
      if (!diagRes.ok || diag.error) {
        // A 404 here is itself the answer: this build predates diagnostics.
        setError(
          diagRes.status === 404
            ? 'This deployment does not serve /api/v1/diagnostics, so it was built before this panel existed.'
            : diag.error || 'Unable to read diagnostics.',
        );
        return;
      }
      setData(diag as Diagnostics);

      const list = await readJsonResponse(eventRes, {
        consequence: 'Unable to read the activity log',
        moduleProcess: 'settings / event request',
        fallbackCause: 'the events endpoint did not return JSON',
      });
      setEvents(eventRes.ok && !list.error ? ((list.events ?? []) as EventRow[]) : []);
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to read diagnostics',
        moduleProcess: 'settings / diagnostics request',
        cause: `browser could not reach the diagnostics endpoints; ${errorCause(err)}`,
      }));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (!token) return null;

  return (
    <div className="space-y-6">
      <div className={CARD}>
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-md bg-slate-950 p-3 text-white dark:bg-sky-400 dark:text-slate-950">
            <Activity size={22} />
          </div>
          <div className="flex-1">
            <p className={LABEL}>Settings</p>
            <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Diagnostics</h2>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => void load()}
            disabled={loading}
            type="button"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        {data && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Version" value={data.build.version} />
              <Stat label="Environment" value={data.build.environment} />
              <Stat label="Commit" value={data.build.commit ? data.build.commit.slice(0, 8) : 'unknown'} />
              <Stat
                label="Database"
                value={data.database.ok ? `ok (${data.database.latencyMs} ms)` : 'unreachable'}
                tone={data.database.ok ? 'ok' : 'error'}
              />
            </dl>

            {data.build.branch && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Built from <span className="font-mono">{data.build.branch}</span> on {data.build.runtime}
              </p>
            )}

            {!data.database.ok && data.database.error && (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                {data.database.error}
              </p>
            )}

            {data.counts && (
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {Object.entries(data.counts).map(([key, value]) => (
                  <Stat key={key} label={key.replace(/_/g, ' ')} value={value.toLocaleString()} />
                ))}
              </dl>
            )}

            {data.config.length > 0 && (
              <div className="mt-5">
                <p className={LABEL}>Configuration</p>
                <ul className="mt-2 space-y-2">
                  {data.config.map((issue) => (
                    <li
                      key={issue.key}
                      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <span>
                        <span className="font-mono font-semibold">{issue.key}</span> {issue.problem}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5">
              <p className={LABEL}>Features in this build</p>
              <ul className="mt-2 space-y-1.5">
                {data.features.map((feature) => (
                  <li key={feature.id} className="flex items-start gap-2 text-sm">
                    {feature.present
                      ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      : <XCircle size={15} className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-600" />}
                    <span className={feature.present ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}>
                      <span className="font-medium">{feature.label}</span>
                      <span className="text-slate-500 dark:text-slate-400"> — {feature.description}</span>
                      {!feature.present && (
                        <span className="text-slate-400 dark:text-slate-500"> (needs {feature.migration})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      <div className={CARD}>
        <p className={LABEL}>Recent activity</p>
        <h2 className="mb-1 text-lg font-semibold text-slate-950 dark:text-white">Event log</h2>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          Every recorded write, newest first. Stored in Postgres, so this is the whole instance rather than one server.
        </p>

        {events === null && !error && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
        {events !== null && events.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Nothing recorded yet.</p>
        )}

        {events !== null && events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-semibold">When</th>
                  <th className="py-2 pr-3 font-semibold">Action</th>
                  <th className="py-2 pr-3 font-semibold">Actor</th>
                  <th className="py-2 font-semibold">Session</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {events.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {row.action}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{row.actor}</td>
                    <td className="py-2 text-slate-600 dark:text-slate-300">
                      {row.session_title ?? row.session_id ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'error' }) {
  const colour =
    tone === 'error'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'ok'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-slate-950 dark:text-white';
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`mt-0.5 font-mono text-sm font-medium ${colour}`}>{value}</dd>
    </div>
  );
}
