import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Play,
  RefreshCw,
} from 'lucide-react';
import {
  buildYouTubeEmbedUrl,
  formatSeconds,
  isValidYouTubeId,
  normalizeYouTubeUrl,
} from '../utils/youtube';
import {
  buildHandshakeCommands,
  isTrustedYouTubeOrigin,
  YOUTUBE_TARGET_ORIGIN,
  YouTubePlayerSyncController,
  type YouTubePlayerCommand,
  type YouTubePlayerStateSnapshot,
} from '../utils/youtubePlayerController';

export interface SeekRequest {
  seconds: number;
  nonce: number;
}

interface YouTubePlayerCardProps {
  videoId: string;
  title: string;
  channel: string;
  seekRequest: SeekRequest;
  activeTimestampLabel: string;
  /** Mobile collapsible props */
  collapsible?: boolean;
  minimized?: boolean;
  onToggleMinimize?: () => void;
  /** Marks the built-in demonstration lecture clearly */
  isDemo?: boolean;
}

export const YouTubePlayerCard = memo(function YouTubePlayerCard({
  videoId,
  title,
  channel,
  seekRequest,
  activeTimestampLabel,
  collapsible = false,
  minimized = false,
  onToggleMinimize,
  isDemo = false,
}: YouTubePlayerCardProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const controllerRef = useRef<YouTubePlayerSyncController>(
    new YouTubePlayerSyncController()
  );
  const handshakeTimerRef = useRef<number | null>(null);
  const initialStartRef = useRef<number>(seekRequest.seconds);
  const lastVideoIdRef = useRef<string>(videoId);

  const [reloadNonce, setReloadNonce] = useState(0);
  const [snapshot, setSnapshot] = useState<YouTubePlayerStateSnapshot>(() =>
    controllerRef.current.getSnapshot()
  );

  const hasValidVideo = isValidYouTubeId(videoId);

  if (lastVideoIdRef.current !== videoId) {
    lastVideoIdRef.current = videoId;
    initialStartRef.current = seekRequest.seconds;
  }

  const clearHandshakeTimer = useCallback(() => {
    if (handshakeTimerRef.current !== null) {
      window.clearInterval(handshakeTimerRef.current);
      handshakeTimerRef.current = null;
    }
  }, []);

  const sendCommands = useCallback((commands: YouTubePlayerCommand[]) => {
    const win = iframeRef.current?.contentWindow;
    if (!win || commands.length === 0) return;
    for (const cmd of commands) {
      try {
        win.postMessage(JSON.stringify(cmd), YOUTUBE_TARGET_ORIGIN);
      } catch {
        // Ignore cross-origin frame teardown races
      }
    }
  }, []);

  // Reset controller cleanly whenever video or retry nonce changes
  useEffect(() => {
    clearHandshakeTimer();
    controllerRef.current.resetForVideo(
      hasValidVideo ? videoId : '',
      seekRequest.seconds,
      hasValidVideo && seekRequest.nonce > 0
    );
    setSnapshot(controllerRef.current.getSnapshot());

    return () => {
      clearHandshakeTimer();
    };
    // Intentionally reset only on videoId, hasValidVideo, or explicit reloadNonce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, hasValidVideo, reloadNonce, clearHandshakeTimer]);

  // Listen to verified YouTube IFrame API postMessage events (onReady, infoDelivery, onError)
  useEffect(() => {
    if (!hasValidVideo) return;

    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedYouTubeOrigin(event.origin)) return;
      const frameWindow = iframeRef.current?.contentWindow;
      if (frameWindow && event.source && event.source !== frameWindow) return;

      const { handled, commandsToSend } = controllerRef.current.handleMessage(
        event.data,
        event.origin
      );
      if (!handled) return;

      const nextSnapshot = controllerRef.current.getSnapshot();
      if (nextSnapshot.status === 'ready' || nextSnapshot.status === 'error') {
        clearHandshakeTimer();
      }
      if (commandsToSend.length > 0) {
        sendCommands(commandsToSend);
      }
      setSnapshot(nextSnapshot);
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [hasValidVideo, clearHandshakeTimer, sendCommands]);

  // Queue or immediately execute seek requests depending on verified YouTube player readiness
  useEffect(() => {
    if (!hasValidVideo || seekRequest.nonce === 0) return;
    const commandsToSend = controllerRef.current.requestSeek(seekRequest.seconds);
    if (commandsToSend.length > 0) {
      sendCommands(commandsToSend);
    }
    setSnapshot(controllerRef.current.getSnapshot());
  }, [seekRequest, hasValidVideo, sendCommands]);

  const embedUrl = useMemo(() => {
    if (!hasValidVideo) return '';
    const base = buildYouTubeEmbedUrl(videoId, initialStartRef.current);
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${base}&origin=${encodeURIComponent(window.location.origin)}`;
    }
    return base;
  }, [videoId, hasValidVideo, reloadNonce]);

  const handleIframeLoad = useCallback(() => {
    if (!hasValidVideo) return;

    const commands = buildHandshakeCommands(1);
    sendCommands(commands);

    clearHandshakeTimer();
    let attempts = 1;
    handshakeTimerRef.current = window.setInterval(() => {
      const currentStatus = controllerRef.current.getSnapshot().status;
      if (currentStatus === 'ready' || currentStatus === 'error' || attempts >= 12) {
        clearHandshakeTimer();
        return;
      }
      attempts += 1;
      sendCommands(commands);
    }, 300);
  }, [hasValidVideo, sendCommands, clearHandshakeTimer]);

  const handleRetryPlayer = () => {
    initialStartRef.current = seekRequest.seconds;
    setReloadNonce((n) => n + 1);
  };

  const chapterLabel = activeTimestampLabel || formatSeconds(seekRequest.seconds);
  const livePlaybackLabel =
    snapshot.playbackSeconds !== null ? formatSeconds(snapshot.playbackSeconds) : null;
  const showDistinctPlayback =
    Boolean(livePlaybackLabel) && livePlaybackLabel !== chapterLabel;
  const externalYouTubeUrl = hasValidVideo ? normalizeYouTubeUrl(videoId) : '';

  return (
    <section
      aria-label="YouTube Video Player"
      data-player-status={snapshot.status}
      className="rounded-2xl mf-panel overflow-hidden transition-colors duration-150"
    >
      {/* Compact Header / Mobile Minimize Bar */}
      {collapsible && (
        <div className="flex items-center justify-between gap-2.5 px-3.5 py-2 border-b border-white/[0.07] bg-white/[0.015]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/16 text-violet-300 border border-violet-400/25">
              {hasValidVideo ? (
                <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              ) : (
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </span>
            <p className="text-[13px] font-semibold text-slate-100 truncate">{title}</p>
            {isDemo && (
              <span
                data-testid="demo-badge-mobile"
                title="Built-in sample demonstration — paste any YouTube URL to analyze your own video"
                className="rounded bg-amber-400/12 border border-amber-400/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-200 shrink-0"
              >
                DEMO
              </span>
            )}
            <span
              data-testid="player-synced-timestamp-mobile"
              title="Selected chapter timestamp"
              className="font-mono tabular-nums text-xs text-cyan-300 shrink-0"
            >
              {chapterLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={onToggleMinimize}
            aria-expanded={!minimized}
            aria-label={minimized ? 'Expand video player' : 'Minimize video player'}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 min-h-[38px] text-xs font-semibold text-slate-200 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>{minimized ? 'Expand' : 'Minimize'}</span>
            {minimized ? (
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      )}

      {/* 16:9 YouTube IFrame Container or Clean Transcript-Only / Error Fallback */}
      <div
        className={`relative w-full bg-[#04060d] transition-all duration-200 ${
          minimized ? 'h-0 overflow-hidden opacity-0 pointer-events-none' : 'aspect-video opacity-100'
        }`}
      >
        {hasValidVideo ? (
          <>
            <iframe
              key={`${videoId}-${reloadNonce}`}
              ref={iframeRef}
              title={`${title} — YouTube player`}
              src={embedUrl}
              onLoad={handleIframeLoad}
              className="absolute inset-0 h-full w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="eager"
            />
            {snapshot.status === 'error' && (
              <div
                role="alert"
                data-testid="youtube-player-error"
                className="absolute inset-0 z-10 flex flex-col items-center justify-center p-5 text-center bg-[#060a16]/95 backdrop-blur-sm"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/15 border border-rose-400/30 text-rose-300 mb-2.5">
                  <AlertTriangle className="w-5 h-5" aria-hidden="true" />
                </span>
                <p className="font-display text-sm font-semibold text-white">
                  Embedded playback unavailable
                </p>
                <p className="text-xs text-slate-300 mt-1 max-w-[300px] leading-relaxed">
                  {snapshot.errorMessage || 'YouTube prevented embedded playback for this video.'}
                </p>
                <div className="mt-3.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRetryPlayer}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/12 px-3.5 py-2 min-h-[38px] text-xs font-semibold text-white transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                  {externalYouTubeUrl && (
                    <a
                      href={externalYouTubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/35 px-3.5 py-2 min-h-[38px] text-xs font-semibold text-violet-100 transition-colors"
                    >
                      <span>Open on YouTube</span>
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div
            data-testid="transcript-only-player-placeholder"
            className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center bg-gradient-to-br from-violet-950/45 via-[#070b18] to-cyan-950/35"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/20 border border-violet-400/35 text-cyan-300 mb-2.5">
              <FileText className="w-5 h-5" aria-hidden="true" />
            </span>
            <p className="font-display text-sm font-semibold text-white">
              Transcript-Only Workspace
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-[280px] leading-relaxed">
              Built directly from your pasted notes with no linked YouTube video. Paste a YouTube link anytime to sync video playback.
            </p>
          </div>
        )}
      </div>

      {/* Desktop Footer Metadata Line */}
      {!collapsible && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/[0.08] bg-white/[0.015]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-[13.5px] font-semibold text-slate-100 truncate">{title}</p>
              {isDemo && (
                <span
                  data-testid="demo-badge-player"
                  title="Built-in sample demonstration — paste any YouTube URL above to analyze your own video"
                  className="rounded bg-amber-400/12 border border-amber-400/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-200 shrink-0"
                >
                  DEMO
                </span>
              )}
              {!isDemo && !hasValidVideo && (
                <span
                  data-testid="transcript-badge-player"
                  title="Transcript-only workspace with no linked YouTube video"
                  className="rounded bg-violet-500/15 border border-violet-400/30 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-200 shrink-0"
                >
                  TRANSCRIPT
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              {isDemo ? `${channel} · Sample lecture` : channel}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showDistinctPlayback && (
              <span
                data-testid="player-playback-timestamp"
                title="Live YouTube playback position"
                className="font-mono tabular-nums text-xs text-slate-400"
              >
                Live {livePlaybackLabel}
              </span>
            )}
            <div
              data-testid="player-synced-timestamp"
              className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-cyan-300 shrink-0"
              title="Selected chapter timestamp"
            >
              <Play className="w-3 h-3 fill-current text-cyan-400" aria-hidden="true" />
              <span>{chapterLabel}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
