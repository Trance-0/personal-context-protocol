'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Check, KeyRound } from 'lucide-react';
import { SiteNav } from '@/components/site-nav';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';

function getUiToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('ui_token') || '';
}

/**
 * Admin settings for rotating the browser login token after the current token
 * has already been validated. If PCP_ADMIN_TOKEN is configured, the env token
 * owns the credential and UI rotation is intentionally disabled.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [newToken, setNewToken] = useState('');
  const [confirmToken, setConfirmToken] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Held in state rather than read per render: localStorage is unavailable
  // during the server pass, and the panel needs a stable value to fetch with.
  const [token, setToken] = useState('');

  useEffect(() => {
    const current = getUiToken();
    if (!current) {
      router.replace('/login?next=/settings');
      return;
    }
    setToken(current);
  }, [router]);

  async function updateToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = newToken.trim();
    if (candidate.length < 32) {
      setError('Unable to update admin token: admin settings / custom token validation - token must be at least 32 characters');
      return;
    }
    if (candidate !== confirmToken.trim()) {
      setError('Unable to update admin token: admin settings / custom token confirmation - token fields do not match');
      return;
    }

    setLoading(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch('/api/v1/auth/token', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getUiToken()}`,
        },
        body: JSON.stringify({ new_token: candidate }),
      });
      const data = await readJsonResponse(response, {
        consequence: 'Unable to update admin token',
        moduleProcess: 'admin settings / custom token update request',
        fallbackCause: 'admin token endpoint did not return JSON',
      });

      if (!response.ok || data.error) {
        setError(data.error || 'Unable to update admin token: admin settings / custom token update request - token was not accepted');
        return;
      }

      localStorage.setItem('ui_token', candidate);
      setToken(candidate);
      setNewToken('');
      setConfirmToken('');
      setStatus('Admin token updated. This browser now uses the new token.');
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to update admin token',
        moduleProcess: 'admin settings / custom token update request',
        cause: `browser could not reach /api/v1/auth/token or parse its response; ${errorCause(err)}`,
      }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <SiteNav />
      <section className="mx-auto max-w-3xl space-y-6 px-4 py-12 sm:px-6">
        <form className="rounded-md border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900" onSubmit={updateToken}>
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-md bg-slate-950 p-3 text-white dark:bg-sky-400 dark:text-slate-950">
              <KeyRound size={22} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Settings</p>
              <h1 className="text-xl font-semibold text-slate-950 dark:text-white">Admin token</h1>
            </div>
          </div>

          <p className="mb-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Set a custom admin token after logging in with a valid token. Store it securely; the app stores only a salted hash.
          </p>

          {status && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
              <Check size={16} />
              <span>{status}</span>
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </div>
          )}

          <label className="mb-3 block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">New admin token</span>
            <input
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950"
              value={newToken}
              onChange={(event) => setNewToken(event.target.value)}
              placeholder="32+ characters"
              type="password"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Confirm admin token</span>
            <input
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950"
              value={confirmToken}
              onChange={(event) => setConfirmToken(event.target.value)}
              placeholder="Repeat token"
              type="password"
            />
          </label>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
              disabled={loading}
              type="submit"
            >
              {loading ? 'Saving...' : 'Update token'}
            </button>
            <Link className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" href="/dashboard">
              <ArrowLeft size={16} /> Dashboard
            </Link>
          </div>
        </form>

        {/* What this deployment is and what it has been doing. Answering
            either question previously meant probing the API by hand. */}
        <DiagnosticsPanel token={token} />
      </section>
    </main>
  );
}