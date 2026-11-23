import { type FormEvent, useEffect, useState } from 'react';
import { FileText, Link2, Loader2, Sparkles, X } from 'lucide-react';
import { resolveManualTranscriptIdentity } from '../utils/manualTranscript';

export interface ManualTranscriptSubmitPayload {
  transcript: string;
  optionalYouTubeUrl: string;
}

interface ManualTranscriptModalProps {
  open: boolean;
  isAnalyzing: boolean;
  onClose: () => void;
  onSubmitTranscript: (payload: ManualTranscriptSubmitPayload) => void;
}

export function ManualTranscriptModal({
  open,
  isAnalyzing,
  onClose,
  onSubmitTranscript,
}: ManualTranscriptModalProps) {
  const [transcriptText, setTranscriptText] = useState('');
  const [optionalYouTubeUrl, setOptionalYouTubeUrl] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [urlValidationError, setUrlValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setValidationError(null);
      setUrlValidationError(null);
      setOptionalYouTubeUrl('');
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isAnalyzing) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, isAnalyzing, onClose]);

  if (!open) return null;

  const trimmedLength = transcriptText.trim().length;
  const trimmedOptionalUrl = optionalYouTubeUrl.trim();
  const previewIdentity = trimmedOptionalUrl
    ? resolveManualTranscriptIdentity({
        transcript: transcriptText || 'preview',
        optionalYouTubeUrl: trimmedOptionalUrl,
      })
    : null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = transcriptText.trim();
    if (trimmed.length < 40) {
      setValidationError(
        'Please paste at least a couple of sentences (40+ characters) from the video transcript or notes.'
      );
      return;
    }

    const identity = resolveManualTranscriptIdentity({
      transcript: trimmed,
      optionalYouTubeUrl: trimmedOptionalUrl,
    });
    if (!identity.ok) {
      setUrlValidationError(
        identity.error ||
          'Enter a valid YouTube URL or 11-character ID, or leave this blank for a transcript-only workspace.'
      );
      return;
    }

    setValidationError(null);
    setUrlValidationError(null);
    onSubmitTranscript({
      transcript: trimmed,
      optionalYouTubeUrl: identity.youtubeUrl,
    });
    setTranscriptText('');
    setOptionalYouTubeUrl('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-transcript-title"
    >
      <button
        type="button"
        aria-label="Close manual transcript modal"
        onClick={() => {
          if (!isAnalyzing) onClose();
        }}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm cursor-default mf-animate-fade"
      />

      <form
        onSubmit={handleSubmit}
        data-testid="manual-transcript-modal"
        className="relative z-10 w-full max-w-lg max-h-[90dvh] overflow-y-auto glass-scroll rounded-3xl mf-modal-surface backdrop-blur-md p-5 sm:p-6 space-y-4 mf-animate-modal"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/20 border border-violet-400/35 text-violet-300">
              <FileText className="w-4.5 h-4.5" aria-hidden="true" />
            </span>
            <div>
              <h2
                id="manual-transcript-title"
                className="font-display text-base sm:text-lg font-bold text-white"
              >
                Paste Transcript Manually
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Creates an independent study workspace from your notes or captions
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isAnalyzing}
            aria-label="Close manual transcript modal"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-slate-300 hover:text-white cursor-pointer disabled:opacity-50 shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Optional YouTube URL input */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label
              htmlFor="manual-youtube-url-input"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200"
            >
              <Link2 className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span>Optional YouTube video link</span>
            </label>
            <span className="text-xs text-slate-400">
              {previewIdentity && previewIdentity.ok && previewIdentity.sourceType === 'youtube'
                ? `Links to ${previewIdentity.videoId}`
                : 'Leave blank for transcript-only'}
            </span>
          </div>
          <input
            id="manual-youtube-url-input"
            data-testid="manual-youtube-url-input"
            type="text"
            value={optionalYouTubeUrl}
            onChange={(e) => {
              setOptionalYouTubeUrl(e.target.value);
              if (urlValidationError) setUrlValidationError(null);
            }}
            placeholder="Optional: https://www.youtube.com/watch?v=..."
            className="w-full rounded-xl bg-[#070b18] border border-white/12 px-3.5 py-2.5 min-h-[44px] text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60"
          />
          {urlValidationError && (
            <p role="alert" className="mt-1.5 text-xs text-rose-300">
              {urlValidationError}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label
              htmlFor="manual-transcript-input"
              className="block text-xs font-semibold text-slate-200"
            >
              Video transcript or key notes
            </label>
            <span
              className={`font-mono text-xs ${
                trimmedLength >= 40 ? 'text-emerald-300' : 'text-slate-400'
              }`}
            >
              {trimmedLength.toLocaleString()} chars{trimmedLength < 40 ? ' (min 40)' : ' · Ready'}
            </span>
          </div>
          <textarea
            id="manual-transcript-input"
            data-testid="manual-transcript-input"
            rows={7}
            value={transcriptText}
            onChange={(e) => {
              setTranscriptText(e.target.value);
              if (validationError) setValidationError(null);
            }}
            placeholder="Paste YouTube transcript lines (timestamps optional, e.g. 00:15 Welcome back...)"
            className="w-full rounded-2xl bg-[#070b18] border border-white/12 p-3.5 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60 glass-scroll resize-y"
          />
          {validationError && (
            <p role="alert" className="mt-1.5 text-xs text-rose-300">
              {validationError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isAnalyzing}
            className="rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 px-4 py-2 min-h-[42px] text-xs font-semibold text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-4 py-2 min-h-[42px] text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-60"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Build Mindmap</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
