import React, { useEffect, useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import Logo from './ui/Logo';

// Shown while the first account/workspace request is pending. The hosted backend can take most of a
// minute to wake up, so after a few seconds we say so instead of showing a blank page.
export default function BootScreen({ error, onRetry, onSignOut }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (error) return undefined;
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(timer);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm text-center animate-fade-in" role="status" aria-live="polite">
        <div className="flex justify-center mb-8">
          <Logo className="h-8" />
        </div>
        {error ? (
          <>
            <div className="w-11 h-11 mx-auto mb-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-700" aria-hidden="true" />
            </div>
            <h1 className="text-base font-bold text-slate-900">Can't reach NexaMind</h1>
            <p className="text-sm text-slate-600 mt-1.5">{error}</p>
            <div className="flex justify-center gap-2 mt-6">
              <button type="button" onClick={onRetry} className="btn-primary press">
                <RotateCcw className="w-4 h-4" aria-hidden="true" /> Try again
              </button>
              <button type="button" onClick={onSignOut} className="btn-secondary">
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2.5" aria-hidden="true">
              <div className="skeleton h-3 w-3/4 mx-auto" />
              <div className="skeleton h-3 w-1/2 mx-auto" />
            </div>
            <p className="text-sm text-slate-600 mt-6">
              {slow ? 'Waking up the server. This can take up to a minute after a quiet period…' : 'Loading your workspace…'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
