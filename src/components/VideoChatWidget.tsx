import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  LanguageCode,
  LectureWorkspace,
  VideoChatMessage,
} from '../types/mindflow';
import { buildDynamicChatPrompts } from '../utils/youtube';
import { compactWorkspaceForChat } from '../utils/serverGuards';
import { apiFetch } from '../utils/apiFetch';
import {
  appendChatMessageToStore,
  clearVideoChatFromStore,
  findLastFailedTurn,
  getMessagesForVideo,
  loadChatStoreFromStorage,
  removeChatMessageFromStore,
  saveChatStoreToStorage,
  type PersistedChatStore,
} from '../utils/chatStorage';

interface VideoChatWidgetProps {
  open: boolean;
  mode: 'docked' | 'mobile-sheet';
  workspace: LectureWorkspace;
  language: LanguageCode;
  onClose: () => void;
  onJumpToTimestamp: (seconds: number) => void;
}

const LANG_LABEL: Record<LanguageCode, string> = {
  en: 'English',
  hi: 'हिंदी',
  hinglish: 'Hinglish',
};

const CHAT_REQUEST_TIMEOUT_MS = 45_000;

type AiServiceStatus =
  | 'checking'
  | 'configured'
  | 'not_configured'
  | 'in_progress'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'request_failed';

export function VideoChatWidget({
  open,
  mode,
  workspace,
  language,
  onClose,
  onJumpToTimestamp,
}: VideoChatWidgetProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiServiceStatus>('checking');
  const [aiStatusDetail, setAiStatusDetail] = useState<string | null>(null);
  const [chatStore, setChatStore] = useState<PersistedChatStore>(() =>
    loadChatStoreFromStorage()
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  const messages = getMessagesForVideo(chatStore, workspace.videoId);

  const lastFailedTurn = useMemo(() => findLastFailedTurn(messages), [messages]);

  const compactWorkspace = useMemo(
    () => compactWorkspaceForChat(workspace as unknown as Record<string, unknown>),
    [workspace]
  );

  const quickPrompts = useMemo(
    () => buildDynamicChatPrompts(workspace, language),
    [workspace, language]
  );

  useEffect(() => {
    if (!open) return;
    let isMounted = true;
    fetch('/api/health')
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        return (await r.json()) as { aiConfigured?: boolean };
      })
      .then((data) => {
        if (!isMounted || typeof data?.aiConfigured !== 'boolean') return;
        setAiStatus((prev) => {
          if (!data.aiConfigured) return 'not_configured';
          if (prev === 'checking' || prev === 'not_configured' || prev === 'temporarily_unavailable') {
            return 'configured';
          }
          return prev;
        });
        if (!data.aiConfigured) {
          setAiStatusDetail(
            'GEMINI_API_KEY is not set on the server. Set your API key in the environment to ask questions about this video.'
          );
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setAiStatus('temporarily_unavailable');
        setAiStatusDetail(
          'Unable to reach the MindFlow AI backend right now. Check your connection or try again shortly.'
        );
      });
    return () => {
      isMounted = false;
    };
  }, [open]);

  useEffect(() => {
    saveChatStoreToStorage(chatStore);
  }, [chatStore]);

  // Abort any in-flight chat request if user switches videos or unmounts
  useEffect(() => {
    return () => {
      activeAbortRef.current?.abort();
      activeAbortRef.current = null;
    };
  }, [workspace.videoId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 80);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages.length, isSending]);

  if (!open) return null;

  const sendQuestion = async (
    rawQuestion: string,
    options?: { retryErrorMessageId?: string }
  ) => {
    const question = rawQuestion.trim();
    if (!question || isSending) return;

    const targetVideoId = workspace.videoId;
    const retryErrorId = options?.retryErrorMessageId;
    const isRetryAttempt = Boolean(retryErrorId);

    const existingMessages = getMessagesForVideo(chatStore, targetVideoId);
    const currentHistory = existingMessages
      .filter((m) => !m.isError)
      // Avoid sending the exact question being retried twice inside history
      .filter((m, idx, arr) => {
        if (isRetryAttempt && idx === arr.length - 1 && m.role === 'user' && m.content.trim() === question) {
          return false;
        }
        return true;
      });

    if (isRetryAttempt && retryErrorId) {
      // Remove the stale failed assistant bubble in place without duplicating the user's question
      setChatStore((prev) => removeChatMessageFromStore(prev, targetVideoId, retryErrorId));
      setIsRetrying(true);
    } else {
      const userMsg: VideoChatMessage = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content: question,
        createdAt: Date.now(),
      };
      setChatStore((prev) => appendChatMessageToStore(prev, targetVideoId, userMsg));
      setInput('');
      setIsRetrying(false);
    }

    setIsSending(true);
    setAiStatus('in_progress');
    setAiStatusDetail(null);

    activeAbortRef.current?.abort();
    const controller = new AbortController();
    activeAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => {
      controller.abort('timeout');
    }, CHAT_REQUEST_TIMEOUT_MS);

    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          question,
          workspace: compactWorkspace,
          language,
          history: currentHistory.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      let data: {
        answer?: string;
        error?: string;
        code?: string;
        retryAfterSeconds?: number;
        citations?: VideoChatMessage['citations'];
      } | null = null;
      try {
        const raw = await response.text();
        data = raw.trim() ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      const succeeded =
        response.ok && typeof data?.answer === 'string' && data.answer.trim().length > 0;

      const fallbackErrorText =
        data?.code === 'AI_QUOTA_EXHAUSTED'
          ? data.error ||
            'AI API quota is exhausted for this key. Please check your billing or quota settings and try again later.'
          : response.status === 429
            ? data?.error ||
              (typeof data?.retryAfterSeconds === 'number'
                ? `Rate limit reached. Please wait about ${data.retryAfterSeconds}s and click Retry.`
                : 'AI rate limit reached. Please wait a few seconds and click Retry.')
            : response.status === 503 &&
                (data?.code === 'AI_AUTH_ERROR' || data?.code === 'AI_NOT_CONFIGURED')
              ? 'AI service is not configured on the server. Please set GEMINI_API_KEY in server environment settings.'
              : response.status === 503 || response.status === 504
                ? data?.error || 'The AI service is temporarily unavailable. Click Retry to try again.'
                : data?.error || 'Could not answer right now. Please click Retry.';

      if (succeeded) {
        setAiStatus('configured');
        setAiStatusDetail(null);
      } else if (data?.code === 'AI_AUTH_ERROR' || data?.code === 'AI_NOT_CONFIGURED') {
        setAiStatus('not_configured');
        setAiStatusDetail(fallbackErrorText);
      } else if (data?.code === 'AI_QUOTA_EXHAUSTED') {
        setAiStatus('quota_exhausted');
        setAiStatusDetail(fallbackErrorText);
      } else if (
        response.status === 429 ||
        data?.code === 'AI_RATE_LIMITED' ||
        data?.code === 'RATE_LIMITED' ||
        data?.code === 'AI_HOURLY_BUDGET_EXCEEDED'
      ) {
        setAiStatus('rate_limited');
        setAiStatusDetail(fallbackErrorText);
      } else if (
        response.status === 503 ||
        response.status === 504 ||
        data?.code === 'AI_OVERLOADED' ||
        data?.code === 'SERVER_BUSY'
      ) {
        setAiStatus('temporarily_unavailable');
        setAiStatusDetail(fallbackErrorText);
      } else {
        setAiStatus('request_failed');
        setAiStatusDetail(fallbackErrorText);
      }

      const assistantMsg: VideoChatMessage = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: succeeded ? data!.answer!.trim() : fallbackErrorText,
        citations: succeeded && Array.isArray(data?.citations) ? data.citations : [],
        createdAt: Date.now(),
        ...(succeeded ? {} : { isError: true, failedQuestion: question }),
      };

      setChatStore((prev) => appendChatMessageToStore(prev, targetVideoId, assistantMsg));
    } catch (err) {
      // Ignore silent aborts caused by switching videos/unmounting
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') {
        setAiStatus((prev) => (prev === 'in_progress' ? 'configured' : prev));
        return;
      }
      const isTimeout =
        controller.signal.reason === 'timeout' ||
        (err instanceof Error && err.name === 'AbortError');
      const failureMessage = isTimeout
        ? 'The AI tutor took too long to respond. Click Retry to try again.'
        : 'Network error reaching video Q&A. Check your connection and click Retry.';
      setAiStatus(isTimeout ? 'request_failed' : 'temporarily_unavailable');
      setAiStatusDetail(failureMessage);
      const errMsg: VideoChatMessage = {
        id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: failureMessage,
        createdAt: Date.now(),
        isError: true,
        failedQuestion: question,
      };
      setChatStore((prev) => appendChatMessageToStore(prev, targetVideoId, errMsg));
    } finally {
      window.clearTimeout(timeoutId);
      if (activeAbortRef.current === controller) {
        activeAbortRef.current = null;
      }
      setIsSending(false);
      setIsRetrying(false);
    }
  };

  const handleClearChat = () => {
    activeAbortRef.current?.abort();
    setChatStore((prev) => clearVideoChatFromStore(prev, workspace.videoId));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendQuestion(input);
  };

  const panelBody = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-2.5 px-4 py-3.5 border-b border-white/[0.08] bg-white/[0.02] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-500/18 border border-violet-400/30 text-violet-200">
            <Sparkles className="w-4 h-4 text-cyan-300" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold text-white leading-tight">
              Ask This Video
            </h2>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              {workspace.title} · {LANG_LABEL[language]}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {messages.length > 0 && !isSending && (
            <button
              type="button"
              data-testid="clear-chat-btn"
              onClick={handleClearChat}
              aria-label="Clear conversation"
              title="Clear chat"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] hover:bg-rose-500/20 border border-white/[0.08] text-slate-400 hover:text-rose-200 cursor-pointer transition-colors"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {mode === 'mobile-sheet' && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Minimize Ask This Video chat"
              title="Minimize"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.08] text-slate-300 hover:text-white cursor-pointer shrink-0"
            >
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            data-testid="close-chat-btn"
            onClick={onClose}
            aria-label="Close Ask This Video chat"
            title="Close panel"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.08] text-slate-300 hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Messages Body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto glass-scroll px-4 py-3.5 space-y-3.5"
      >
        {aiStatus === 'not_configured' && (
          <div
            data-testid="ai-not-configured-banner"
            className="flex items-start gap-2.5 rounded-xl bg-amber-500/12 border border-amber-400/30 p-3 text-xs text-amber-200"
          >
            <AlertCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold text-amber-100">AI Service Not Configured</p>
              <p className="mt-0.5 text-amber-200/85 leading-relaxed">
                {aiStatusDetail ||
                  'GEMINI_API_KEY is not set on the server. Set your API key in the environment to ask questions about this video.'}
              </p>
            </div>
          </div>
        )}

        {!isSending &&
          (aiStatus === 'quota_exhausted' ||
            aiStatus === 'rate_limited' ||
            aiStatus === 'temporarily_unavailable') && (
            <div
              data-testid="ai-status-warning-banner"
              data-ai-status={aiStatus}
              className="flex items-start gap-2.5 rounded-xl bg-rose-500/12 border border-rose-400/30 p-3 text-xs text-rose-100"
            >
              <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold text-rose-100">
                  {aiStatus === 'quota_exhausted'
                    ? 'AI Quota Exhausted'
                    : aiStatus === 'rate_limited'
                      ? 'Rate Limit Reached'
                      : 'AI Temporarily Unavailable'}
                </p>
                <p className="mt-0.5 text-rose-200/85 leading-relaxed">
                  {aiStatusDetail ||
                    'The AI service could not complete the last request. You can retry shortly.'}
                </p>
              </div>
            </div>
          )}

        {messages.length === 0 ? (
          <div className="space-y-3.5 pt-0.5">
            <div className="rounded-xl bg-white/[0.035] border border-white/[0.08] p-3.5 text-sm text-slate-300 leading-relaxed">
              Ask any question strictly grounded in{' '}
              <strong className="text-white font-semibold">{workspace.title}</strong>.
              Answers stay in{' '}
              <span className="text-cyan-300 font-semibold">{LANG_LABEL[language]}</span>{' '}
              and include clickable video timestamps.
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400 px-0.5">
                Suggested questions
              </p>
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isSending || aiStatus === 'not_configured'}
                  onClick={() => void sendQuestion(prompt)}
                  className={`w-full text-left rounded-xl bg-white/[0.035] hover:bg-violet-500/14 border border-white/[0.09] hover:border-violet-400/40 px-3.5 py-2.5 min-h-[44px] text-[13.5px] leading-snug text-slate-200 hover:text-white transition-colors ${
                    aiStatus === 'not_configured' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              data-chat-role={msg.role}
              data-chat-error={msg.isError ? 'true' : 'false'}
              className={`flex flex-col ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-violet-600 to-indigo-500 text-white rounded-br-md'
                    : msg.isError
                      ? 'bg-rose-500/12 border border-rose-400/35 text-rose-100 rounded-bl-md'
                      : 'bg-white/[0.05] border border-white/10 text-slate-100 rounded-bl-md'
                }`}
              >
                {msg.isError && (
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-300">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Request failed</span>
                  </div>
                )}
                <p className="whitespace-pre-line">{msg.content}</p>

                {!msg.isError && msg.citations && msg.citations.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-white/10 flex flex-wrap gap-1.5">
                    {msg.citations.map((cite, idx) => (
                      <button
                        key={`${cite.label}-${idx}`}
                        type="button"
                        onClick={() => {
                          onJumpToTimestamp(cite.seconds);
                          if (mode === 'mobile-sheet') onClose();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/28 border border-cyan-400/35 px-2.5 py-1 font-mono text-xs font-semibold text-cyan-200 transition-colors cursor-pointer"
                      >
                        <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                        <span>{cite.label}</span>
                        {cite.topic && (
                          <span className="font-sans text-xs font-medium text-cyan-100/85 max-w-[130px] truncate">
                            · {cite.topic}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {lastFailedTurn && !isSending && (
          <div className="flex justify-start">
            <button
              type="button"
              data-testid="retry-last-question-btn"
              onClick={() =>
                void sendQuestion(lastFailedTurn.question, {
                  retryErrorMessageId: lastFailedTurn.errorMessageId,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/35 px-3 py-2 text-xs font-semibold text-amber-200 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Retry last question</span>
            </button>
          </div>
        )}

        {isSending && (
          <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07] px-3.5 py-2.5 text-xs text-cyan-200">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
            <span>
              {isRetrying
                ? 'Retrying your question...'
                : 'Searching video context & timestamps...'}
            </span>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <form
        onSubmit={handleSubmit}
        className={`p-3 border-t border-white/[0.08] bg-[#070b18]/95 flex items-center gap-2 shrink-0 ${
          mode === 'mobile-sheet' ? 'mf-safe-pb' : ''
        }`}
      >
        <label htmlFor="ask-video-input" className="sr-only">
          Ask a question about this video
        </label>
        <input
          ref={inputRef}
          id="ask-video-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            aiStatus === 'not_configured'
              ? 'AI service not configured on server (GEMINI_API_KEY required)...'
              : `Ask about this video (${LANG_LABEL[language]})...`
          }
          disabled={isSending || aiStatus === 'not_configured'}
          className="flex-1 rounded-xl bg-white/[0.05] border border-white/12 px-3.5 py-2.5 min-h-[44px] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || isSending || aiStatus === 'not_configured'}
          aria-label="Send question"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white transition-colors cursor-pointer disabled:opacity-45"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </form>
    </>
  );

  // Desktop docked right-hand side panel (never obscures the mindmap or notes!)
  if (mode === 'docked') {
    return (
      <aside
        data-mindflow-print-hide="true"
        data-testid="video-chat-drawer"
        aria-label="Ask this video chat"
        className="w-[330px] xl:w-[375px] shrink-0 h-full min-h-0 flex flex-col rounded-2xl mf-panel overflow-hidden mf-animate-fade"
      >
        {panelBody}
      </aside>
    );
  }

  // Mobile responsive safe-area bottom sheet
  return (
    <div
      data-mindflow-print-hide="true"
      className="lg:hidden fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Ask this video chat"
    >
      <button
        type="button"
        aria-label="Close Ask This Video backdrop"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default mf-animate-fade"
      />
      <section
        data-testid="video-chat-drawer"
        className="relative z-10 w-full max-w-2xl h-[min(84dvh,640px)] flex flex-col rounded-t-3xl mf-modal-surface backdrop-blur-md overflow-hidden mf-animate-sheet"
      >
        <div className="flex justify-center pt-2.5 pb-0.5 shrink-0">
          <div className="h-1.5 w-11 rounded-full bg-white/20" aria-hidden="true" />
        </div>
        {panelBody}
      </section>
    </div>
  );
}
