import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, KeyRound, ShieldCheck, X } from 'lucide-react';
import { getStoredGeminiKey, saveStoredGeminiKey } from '../utils/apiFetch';

interface ApiKeyModalProps {
  open: boolean;
  limitReached?: boolean;
  onClose: () => void;
  onNotify: (message: string, variant?: 'success' | 'error' | 'info') => void;
}

/** Lets a visitor use their own free Gemini key so the site owner's shared quota is never consumed. */
export function ApiKeyModal({ open, limitReached, onClose, onNotify }: ApiKeyModalProps) {
  const [value, setValue] = useState('');
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    const stored = getStoredGeminiKey();
    setHasKey(Boolean(stored));
    setValue('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = value.trim();
    if (!/^[A-Za-z0-9_.-]{20,160}$/.test(cleaned)) {
      onNotify('That does not look like a valid Gemini API key.', 'error');
      return;
    }
    saveStoredGeminiKey(cleaned);
    setHasKey(true);
    setValue('');
    onNotify('Your own Gemini key is active. Your usage now counts on your quota.');
    onClose();
  };

  const handleRemove = () => {
    saveStoredGeminiKey('');
    setHasKey(false);
    onNotify('Your key was removed from this browser.', 'info');
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/65 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="apikey-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl mf-modal-surface border border-white/12 p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/18 border border-violet-400/30">
              <KeyRound className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            </span>
            <h2 id="apikey-title" className="font-display text-base font-bold text-white">
              Use your own Gemini key
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {limitReached && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 leading-relaxed">
            The free shared limit is used up. Add your own free key to continue right now.
          </p>
        )}

        <p className="text-sm text-slate-300 leading-relaxed">
          No login needed. Paste a free key from Google AI Studio and all AI features run on{' '}
          <strong className="text-white">your</strong> quota, with no daily cap from this site.
        </p>

        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
        >
          Get a free key <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>

        <form onSubmit={handleSave} className="space-y-3">
          <label htmlFor="user-gemini-key" className="sr-only">
            Gemini API key
          </label>
          <input
            id="user-gemini-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={hasKey ? 'A key is saved — paste a new one to replace' : 'Paste your Gemini API key'}
            className="w-full rounded-xl bg-[#0b1022] border border-white/15 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white cursor-pointer active:scale-[0.98]"
            >
              Save key
            </button>
            {hasKey && (
              <button
                type="button"
                onClick={handleRemove}
                className="rounded-xl border border-white/15 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-rose-500/20 cursor-pointer"
              >
                Remove
              </button>
            )}
          </div>
        </form>

        <p className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          Stored only in this browser and sent securely with your requests. It is never saved on the server.
        </p>
      </div>
    </div>
  );
}
