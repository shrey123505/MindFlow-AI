import { Loader2 } from 'lucide-react';
import type { LanguageCode } from '../types/mindflow';

interface LanguageSwitcherProps {
  value: LanguageCode;
  isTranslating?: boolean;
  compact?: boolean;
  onChange: (lang: LanguageCode) => void;
}

const LANGUAGES: Array<{
  code: LanguageCode;
  label: string;
  shortLabel: string;
  xsLabel: string;
}> = [
  { code: 'en', label: 'English', shortLabel: 'EN', xsLabel: 'EN' },
  { code: 'hi', label: 'Hindi', shortLabel: 'हिंदी', xsLabel: 'हिंदी' },
  { code: 'hinglish', label: 'Hinglish', shortLabel: 'Hinglish', xsLabel: 'Hing' },
];

export function LanguageSwitcher({
  value,
  isTranslating = false,
  compact = false,
  onChange,
}: LanguageSwitcherProps) {
  return (
    <div
      role="group"
      aria-label="Output language"
      className="inline-flex items-center gap-0.5 rounded-full bg-[#070a15]/90 border border-white/[0.1] p-0.5 shrink-0"
    >
      {LANGUAGES.map((lang) => {
        const active = value === lang.code;
        return (
          <button
            key={lang.code}
            type="button"
            disabled={isTranslating}
            aria-label={lang.label}
            aria-pressed={active}
            onClick={() => onChange(lang.code)}
            className={`inline-flex items-center justify-center gap-1 rounded-full font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 ${
              compact
                ? 'px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs min-h-[30px] sm:min-h-[32px]'
                : 'px-3 py-1.5 text-xs min-h-[32px]'
            } ${
              active
                ? 'bg-white/[0.14] text-white border border-white/18 shadow-sm shadow-black/25'
                : 'border border-transparent text-slate-400 hover:text-slate-100 hover:bg-white/[0.06]'
            }`}
          >
            {active && isTranslating && (
              <Loader2 className="w-3 h-3 animate-spin text-cyan-300" aria-hidden="true" />
            )}
            {compact ? (
              <>
                <span className="sm:hidden">{lang.xsLabel}</span>
                <span className="hidden sm:inline">{lang.shortLabel}</span>
              </>
            ) : (
              <span>{lang.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
