import React from 'react';
import { Bot, AlertCircle } from 'lucide-react';

export default function AuthPage({
  authMode,
  setAuthMode,
  authForm,
  setAuthForm,
  authError,
  authLoading,
  onSubmit,
}) {
  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-md w-full glass-panel p-8 rounded-3xl shadow-2xl space-y-6 relative animate-slide-up">
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center mx-auto mb-1">
            <img src="/logo.png" alt="NexaMind" className="h-10 w-auto object-contain" />
          </div>
          <p className="text-slate-500 text-xs">
            Agentic AI workspace for high-velocity teams
          </p>
        </div>

        {authError && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{authError}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {authMode === 'register' && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                required
                placeholder="Jordan Vance"
                className="input-base"
                value={authForm.name}
                onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              required
              placeholder="you@company.com"
              className="input-base"
              value={authForm.email}
              onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              placeholder="••••••••"
              className="input-base"
              value={authForm.password}
              onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
            />
          </div>

          <button type="submit" disabled={authLoading} className="btn-primary w-full py-3">
            {authLoading
              ? 'Authenticating...'
              : authMode === 'login'
              ? 'Sign In'
              : 'Create Account'}
          </button>
        </form>

        <div className="text-center text-sm text-slate-400">
          {authMode === 'login' ? (
            <>
              New to NexaMind?{' '}
              <button
                type="button"
                onClick={() => setAuthMode('register')}
                className="text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already registered?{' '}
              <button
                type="button"
                onClick={() => setAuthMode('login')}
                className="text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                Sign In
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
