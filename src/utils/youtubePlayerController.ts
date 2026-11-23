export const YOUTUBE_TARGET_ORIGIN = 'https://www.youtube.com';
const TRUSTED_YOUTUBE_ORIGINS = new Set([
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
]);

export type YouTubePlayerStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface YouTubePlayerCommand {
  event: 'command' | 'listening';
  func?: string;
  args?: unknown[];
  id?: number;
  channel?: string;
}

export interface YouTubePlayerStateSnapshot {
  status: YouTubePlayerStatus;
  videoId: string;
  selectedChapterSeconds: number;
  playbackSeconds: number | null;
  isPlaying: boolean;
  hasPendingSeek: boolean;
  errorCode: number | null;
  errorMessage: string | null;
}

export function isTrustedYouTubeOrigin(origin: string): boolean {
  return TRUSTED_YOUTUBE_ORIGINS.has(origin);
}

export function describeYouTubeErrorCode(code: number): string {
  switch (code) {
    case 2:
      return 'Invalid YouTube video ID parameter.';
    case 5:
      return 'The video player encountered an HTML5 playback error.';
    case 100:
      return 'This YouTube video is private or no longer available.';
    case 101:
    case 150:
      return 'The video owner disabled embedded playback. You can still study the notes or open it on YouTube.';
    default:
      return 'Could not load the embedded YouTube player.';
  }
}

export function buildSeekCommand(seconds: number): YouTubePlayerCommand {
  return {
    event: 'command',
    func: 'seekTo',
    args: [Math.max(0, Math.floor(seconds)), true],
  };
}

export function buildHandshakeCommands(widgetId = 1): YouTubePlayerCommand[] {
  return [
    { event: 'listening', id: widgetId, channel: 'widget' },
    { event: 'command', func: 'addEventListener', args: ['onReady'] },
    { event: 'command', func: 'addEventListener', args: ['onStateChange'] },
    { event: 'command', func: 'addEventListener', args: ['onError'] },
  ];
}

export interface ParsedYouTubeMessage {
  event: string;
  info?: unknown;
}

/** Safely parses a postMessage payload from YouTube's IFrame player. */
export function parseYouTubeMessage(
  rawData: unknown,
  origin: string
): ParsedYouTubeMessage | null {
  if (!isTrustedYouTubeOrigin(origin)) return null;
  if (typeof rawData === 'string') {
    const trimmed = rawData.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.event === 'string') {
        return { event: parsed.event, info: parsed.info };
      }
      return null;
    } catch {
      return null;
    }
  }
  if (rawData && typeof rawData === 'object' && 'event' in rawData) {
    const obj = rawData as Record<string, unknown>;
    if (typeof obj.event === 'string') {
      return { event: obj.event, info: obj.info };
    }
  }
  return null;
}

/**
 * Pure, testable synchronization controller for YouTube IFrame Player readiness,
 * queued seeking, distinct playback vs chapter timestamps, and graceful errors.
 * Never issues unsolicited playVideo commands.
 */
export class YouTubePlayerSyncController {
  private status: YouTubePlayerStatus = 'idle';
  private videoId = '';
  private selectedChapterSeconds = 0;
  private playbackSeconds: number | null = null;
  private isPlaying = false;
  private pendingSeekSeconds: number | null = null;
  private errorCode: number | null = null;
  private errorMessage: string | null = null;

  resetForVideo(videoId: string, initialChapterSeconds = 0, queueInitialSeek = false): void {
    const safeSec = Math.max(0, Math.floor(initialChapterSeconds));
    this.videoId = videoId;
    this.status = videoId ? 'loading' : 'idle';
    this.selectedChapterSeconds = safeSec;
    this.playbackSeconds = null;
    this.isPlaying = false;
    this.pendingSeekSeconds = queueInitialSeek ? safeSec : null;
    this.errorCode = null;
    this.errorMessage = null;
  }

  /**
   * Requests seeking to a chapter timestamp.
   * If the player is ready, immediately returns the seekTo command (no unsolicited playVideo).
   * Otherwise queues the latest seek target until onReady/initialDelivery arrives.
   */
  requestSeek(seconds: number): YouTubePlayerCommand[] {
    const safeSec = Math.max(0, Math.floor(seconds));
    this.selectedChapterSeconds = safeSec;

    if (this.status !== 'ready') {
      this.pendingSeekSeconds = safeSec;
      return [];
    }

    this.pendingSeekSeconds = null;
    return [buildSeekCommand(safeSec)];
  }

  /** Marks the player ready and flushes any queued seek command. */
  markReady(): YouTubePlayerCommand[] {
    if (this.status === 'error') return [];
    this.status = 'ready';
    if (this.pendingSeekSeconds !== null) {
      const target = this.pendingSeekSeconds;
      this.pendingSeekSeconds = null;
      return [buildSeekCommand(target)];
    }
    return [];
  }

  /** Processes an incoming postMessage event from the YouTube iframe. */
  handleMessage(rawData: unknown, origin: string): {
    handled: boolean;
    commandsToSend: YouTubePlayerCommand[];
  } {
    const parsed = parseYouTubeMessage(rawData, origin);
    if (!parsed) {
      return { handled: false, commandsToSend: [] };
    }

    const commandsToSend: YouTubePlayerCommand[] = [];

    if (parsed.event === 'onReady' || parsed.event === 'initialDelivery') {
      this.extractInfoState(parsed.info);
      commandsToSend.push(...this.markReady());
      return { handled: true, commandsToSend };
    }

    if (parsed.event === 'infoDelivery') {
      this.extractInfoState(parsed.info);
      // Receiving infoDelivery also confirms the player JS is alive and ready
      if (this.status === 'loading') {
        commandsToSend.push(...this.markReady());
      }
      return { handled: true, commandsToSend };
    }

    if (parsed.event === 'onStateChange') {
      if (typeof parsed.info === 'number') {
        this.isPlaying = parsed.info === 1;
      }
      if (this.status === 'loading') {
        commandsToSend.push(...this.markReady());
      }
      return { handled: true, commandsToSend };
    }

    if (parsed.event === 'onError') {
      const code = typeof parsed.info === 'number' ? parsed.info : -1;
      this.status = 'error';
      this.errorCode = code;
      this.errorMessage = describeYouTubeErrorCode(code);
      this.pendingSeekSeconds = null;
      return { handled: true, commandsToSend: [] };
    }

    return { handled: false, commandsToSend: [] };
  }

  handleLoadFailure(message = 'The embedded YouTube player could not load. Check your connection or open the video directly on YouTube.'): void {
    this.status = 'error';
    this.errorCode = null;
    this.errorMessage = message;
    this.pendingSeekSeconds = null;
  }

  private extractInfoState(info: unknown): void {
    if (!info || typeof info !== 'object') return;
    const obj = info as Record<string, unknown>;
    if (typeof obj.currentTime === 'number' && Number.isFinite(obj.currentTime) && obj.currentTime >= 0) {
      this.playbackSeconds = Math.floor(obj.currentTime);
    }
    if (typeof obj.playerState === 'number') {
      this.isPlaying = obj.playerState === 1;
    }
  }

  getSnapshot(): YouTubePlayerStateSnapshot {
    return {
      status: this.status,
      videoId: this.videoId,
      selectedChapterSeconds: this.selectedChapterSeconds,
      playbackSeconds: this.playbackSeconds,
      isPlaying: this.isPlaying,
      hasPendingSeek: this.pendingSeekSeconds !== null,
      errorCode: this.errorCode,
      errorMessage: this.errorMessage,
    };
  }
}
