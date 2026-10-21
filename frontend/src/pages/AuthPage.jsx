import React, { useState, useEffect } from 'react';
import { Bot, AlertCircle, Loader2, ArrowRight, ArrowLeft, RefreshCw, CheckCircle2, Shield, MailCheck } from 'lucide-react';
import { api, setAuthToken } from '../api';

export default function AuthPage({
  authMode = 'login',
  setAuthMode,
  authForm = { name: '', email: '', password: '' },
  setAuthForm,
  authError,
  authLoading,
  onSubmit,
  onLoginSuccess,
}) {
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [devOtpNotice, setDevOtpNotice] = useState(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showGoogleHelp, setShowGoogleHelp] = useState(false);
  const [googleClientId, setGoogleClientId] = useState(null);

  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  useEffect(() => {
    api.getGoogleConfig()
      .then((cfg) => {
        if (cfg?.client_id) {
          setGoogleClientId(cfg.client_id);
        }
      })
      .catch(() => {});
  }, []);

  const handleGoogleCredentialResponse = async (credential) => {
    setGoogleLoading(true);
    setLocalError('');
    try {
      const res = await api.loginWithGoogle(credential);
      if (res?.access_token) {
        setAuthToken(res.access_token);
        if (onLoginSuccess) {
          onLoginSuccess(res.access_token, res.user);
        }
      }
    } catch (err) {
      setLocalError(err.message || 'Google authentication failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleClick = () => {
    if (googleClientId && window.google?.accounts?.id) {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp) => {
          if (resp?.credential) {
            handleGoogleCredentialResponse(resp.credential);
          }
        },
      });
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          setShowGoogleHelp(true);
        }
      });
    } else {
      setShowGoogleHelp(true);
    }
  };

  const handleSendOtp = async (e) => {
    if (e) e.preventDefault();
    setLocalError('');
    const email = (authForm.email || '').trim();
    const name = (authForm.name || '').trim();

    if (!name) {
      setLocalError('Please enter your full name first.');
      return;
    }
    if (!email) {
      setLocalError('Please enter a valid email address.');
      return;
    }
    if (!authForm.password || authForm.password.length < 8) {
      setLocalError('Password must be at least 8 characters long.');
      return;
    }

    setLocalLoading(true);
    try {
      const res = await api.sendOtp(email, 'register');
      setOtpSent(true);
      setOtpCountdown(60);
      if (res?.dev_code) {
        setDevOtpNotice(`Dev Mode: Code is ${res.dev_code}`);
        setOtp(res.dev_code);
      } else {
        setDevOtpNotice(null);
      }
    } catch (err) {
      setLocalError(err.message || 'Failed to send confirmation code. Please check your email.');
    } finally {
      setLocalLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');

    if (authMode === 'register') {
      if (!otpSent) {
        await handleSendOtp();
        return;
      }
      if (!otp.trim()) {
        setLocalError('Please enter the 6-digit confirmation code sent to your email.');
        return;
      }
      setLocalLoading(true);
      try {
        const res = await api.register(
          authForm.name.trim(),
          authForm.email.trim(),
          authForm.password,
          authForm.username || undefined,
          otp.trim()
        );
        if (res?.access_token) {
          setAuthToken(res.access_token);
          if (onLoginSuccess) {
            onLoginSuccess(res.access_token, res.user);
          }
        }
      } catch (err) {
        setLocalError(err.message || 'Registration failed');
      } finally {
        setLocalLoading(false);
      }
      return;
    }

    if (onSubmit) {
      onSubmit(e);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-md w-full glass-panel p-8 rounded-3xl shadow-2xl space-y-6 relative animate-slide-up">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center mx-auto mb-1">
            <img src="/logo.png" alt="NexaMind" className="h-10 w-auto object-contain" />
          </div>
          <h2 className="text-xl font-bold text-slate-100">
            {authMode === 'login' ? 'Sign In to NexaMind' : otpSent ? 'Verify Email Address' : 'Create Account'}
          </h2>
          <p className="text-slate-400 text-xs">
            {authMode === 'login'
              ? 'Agentic AI workspace for high-velocity teams'
              : otpSent
              ? 'Enter the 6-digit code sent to your Gmail/email'
              : 'Start your personal and team workspace in seconds'}
          </p>
        </div>

        {/* Google Sign-In */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleGoogleClick}
            disabled={googleLoading || localLoading}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 text-slate-800 font-semibold text-xs py-2.5 px-4 rounded-xl border border-slate-300 shadow-sm transition cursor-pointer"
          >
            {googleLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
            )}
            <span>Continue with Google</span>
          </button>

          {showGoogleHelp && (
            <div className="p-3 bg-indigo-950/60 border border-indigo-500/30 rounded-xl text-xs space-y-2">
              <p className="text-indigo-200 text-[11px]">
                To link production Google OAuth, set <code className="text-indigo-300 font-mono">GOOGLE_CLIENT_ID</code> in <code className="text-indigo-300 font-mono">backend/.env</code>.
              </p>
              <button
                type="button"
                onClick={() => handleGoogleCredentialResponse('mock_google_:demo.user@gmail.com:Demo User')}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1.5"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Test with Demo Google Account</span>
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <div className="h-px bg-slate-700 flex-1" />
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">or with email</span>
            <div className="h-px bg-slate-700 flex-1" />
          </div>
        </div>

        {(authError || localError) && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{authError || localError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {authMode === 'register' && otpSent ? (
            <div className="space-y-4">
              <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 text-center space-y-1.5">
                <MailCheck className="w-6 h-6 text-indigo-400 mx-auto" />
                <div className="text-xs font-bold text-slate-200">Check your inbox</div>
                <p className="text-[11px] text-slate-400">
                  Confirmation code sent to <span className="text-indigo-300 font-bold">{authForm.email}</span>
                </p>
                <button
                  type="button"
                  onClick={() => { setOtpSent(false); setOtp(''); }}
                  className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 underline mt-1"
                >
                  <ArrowLeft className="w-3 h-3" />
                  <span>Change email or details</span>
                </button>
              </div>

              {devOtpNotice && (
                <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] rounded-xl font-mono text-center">
                  ⚡ {devOtpNotice}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  6-Digit Verification Code
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="123456"
                  className="input-base text-center text-2xl tracking-[0.3em] font-mono font-bold"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                  autoFocus
                />
              </div>

              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-400">Didn't receive email?</span>
                <button
                  type="button"
                  disabled={otpCountdown > 0 || localLoading}
                  onClick={handleSendOtp}
                  className="text-indigo-400 hover:text-indigo-300 disabled:text-slate-500 font-semibold flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${localLoading ? 'animate-spin' : ''}`} />
                  <span>{otpCountdown > 0 ? `Resend (${otpCountdown}s)` : 'Resend Code'}</span>
                </button>
              </div>

              <button
                type="submit"
                disabled={localLoading || authLoading}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2"
              >
                {localLoading || authLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Complete Registration</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <>
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
                  type={authMode === 'login' ? 'text' : 'email'}
                  required
                  placeholder={authMode === 'login' ? 'jordan@company.com or @username' : 'jordan@gmail.com'}
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
                  minLength={authMode === 'register' ? 8 : undefined}
                />
              </div>

              <button
                type="submit"
                disabled={authLoading || localLoading}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2"
              >
                {authLoading || localLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : authMode === 'login' ? (
                  'Sign In'
                ) : (
                  <>
                    <span>Verify Email & Send Code</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </>
          )}
        </form>

        <div className="text-center text-sm text-slate-400">
          {authMode === 'login' ? (
            <>
              New to NexaMind?{' '}
              <button
                type="button"
                onClick={() => {
                  setAuthMode('register');
                  setOtpSent(false);
                  setOtp('');
                  setLocalError('');
                }}
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
                onClick={() => {
                  setAuthMode('login');
                  setOtpSent(false);
                  setOtp('');
                  setLocalError('');
                }}
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
