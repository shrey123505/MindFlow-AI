import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Loader2, LogIn, LogOut, Mail, ShieldCheck, UserRound, X } from 'lucide-react';
import type { AccountUsage, AccountUser, AuthSessionResponse } from '../types/auth';
import { apiFetch } from '../utils/apiFetch';

interface AuthModalProps {
  open: boolean;
  user: AccountUser | null;
  usage: AccountUsage | null;
  onClose: () => void;
  onAuthenticated: (session: AuthSessionResponse) => void;
  onSignedOut: () => void;
}

function usageLine(used: number, limit: number, label: string) {
  const remaining = Math.max(0, limit - used);
  return `${remaining} of ${limit} ${label} left today`;
}

export function AuthModal({
  open,
  user,
  usage,
  onClose,
  onAuthenticated,
  onSignedOut,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === 'signup' && password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json().catch(() => null)) as AuthSessionResponse | null;
      if (!response.ok || !data?.user || !data.usage) {
        setError(data?.error || 'Could not complete sign in. Please try again.');
        return;
      }
      setPassword('');
      setConfirmPassword('');
      onAuthenticated(data);
    } catch {
      setError('Could not reach MindFlow. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        setError('Could not sign out right now. Please try again.');
        return;
      }
      onSignedOut();
    } catch {
      setError('Could not reach MindFlow. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mindflow-account-title"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#0b1020] shadow-[0_28px_90px_rgba(0,0,0,.65)] mf-animate-fade"
      >
        <div className="relative border-b border-white/[0.08] px-6 pb-5 pt-6 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 shadow-lg shadow-violet-950/40">
              {user ? <UserRound className="h-5 w-5 text-white" /> : <LogIn className="h-5 w-5 text-white" />}
            </div>
            <div>
              <h2 id="mindflow-account-title" className="text-lg font-bold text-white">
                {user ? 'Your MindFlow account' : mode === 'signup' ? 'Create your account' : 'Welcome back'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {user ? 'Your saved account and daily AI usage' : 'Sign in to analyze videos and use AI study tools'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close account dialog"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition hover:bg-white/[0.09] hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-7">
          {user ? (
            <>
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
                <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-100">
                  <Mail className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  <span className="break-all">{user.email}</span>
                </div>
                {usage && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-slate-300">Video analyses</span>
                      <span className="font-semibold text-cyan-200">
                        {usageLine(usage.analysesUsed, usage.analysisLimit, 'videos')}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                        style={{ width: `${Math.min(100, (usage.analysesUsed / Math.max(1, usage.analysisLimit)) * 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-slate-300">AI requests (includes analyses)</span>
                      <span className="font-semibold text-violet-200">
                        {usageLine(usage.aiActionsUsed, usage.aiActionLimit, 'requests')}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Resets {new Date(usage.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} local time
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.05] px-3.5 py-3 text-xs leading-relaxed text-emerald-100/80">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <span>Your password is stored as a salted hash. The Gemini API key stays on the server.</span>
              </div>
              {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={busy}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Sign out
              </button>
            </>
          ) : (
            <>
              <form onSubmit={(event) => void submit(event)} className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-300">Email</span>
                  <span className="flex min-h-11 items-center gap-2.5 rounded-xl border border-white/10 bg-[#070a14] px-3.5 focus-within:border-cyan-400/50">
                    <Mail className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    <input
                      autoFocus
                      type="email"
                      name="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
                    />
                  </span>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-300">Password</span>
                  <input
                    type="password"
                    name="password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={mode === 'signup' ? 'At least 12 characters' : 'Your password'}
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#070a14] px-3.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/50"
                  />
                </label>
                {mode === 'signup' && (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">Confirm password</span>
                    <input
                      type="password"
                      name="confirmPassword"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Type it again"
                      className="min-h-11 w-full rounded-xl border border-white/10 bg-[#070a14] px-3.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/50"
                    />
                  </label>
                )}
                {error && <p role="alert" className="text-sm leading-relaxed text-rose-300">{error}</p>}
                <div className="flex items-start gap-2 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] px-3.5 py-3 text-[11px] leading-relaxed text-slate-400">
                  <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />
                  <span>Accounts share this site’s Gemini quota. Daily video and AI limits keep usage bounded; analyses also count toward the AI limit.</span>
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 px-4 text-sm font-bold text-white shadow-lg shadow-violet-950/30 transition hover:from-violet-500 hover:to-cyan-400 disabled:cursor-wait disabled:opacity-65"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                  {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
                </button>
              </form>
              <p className="text-center text-xs text-slate-400">
                {mode === 'signup' ? 'Already have an account?' : 'New to MindFlow?'}{' '}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMode((current) => (current === 'signup' ? 'login' : 'signup'));
                    setError(null);
                  }}
                  className="font-semibold text-cyan-300 transition hover:text-cyan-200 disabled:opacity-50"
                >
                  {mode === 'signup' ? 'Sign in' : 'Create an account'}
                </button>
              </p>
              <p className="text-center text-[10px] leading-relaxed text-slate-600">
                Use a unique password. MindFlow does not send password reset emails.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
