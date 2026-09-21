'use client';

import { useState } from 'react';
import { Check, Clipboard, X } from 'lucide-react';

interface TokenDisplayProps {
  content: string;
  onClose: () => void;
}

/** Modal overlay showing the generated token + instruction block for copying. */
export function TokenDisplay({ content, onClose }: TokenDisplayProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (insecure context / permissions); leave
      // the button in its default state so the user knows to copy manually.
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-md border border-amber-200 bg-white shadow-xl dark:border-amber-900/60 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-900/60 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Copy this token block now. It will not be shown again.</p>
          <div className="flex items-center gap-2">
            <button
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                copied
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'border-amber-200 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-slate-950 dark:text-amber-200'
              }`}
              onClick={copy}
              type="button"
            >
              {copied ? <><Check size={15} /> Copied</> : <><Clipboard size={15} /> Copy</>}
            </button>
            <button className="rounded-md p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-950/60" onClick={onClose} type="button" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <pre className="max-h-[70vh] overflow-auto rounded-b-md bg-white p-4 text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">{content}</pre>
      </div>
    </div>
  );
}
