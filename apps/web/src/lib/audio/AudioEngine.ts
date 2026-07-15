/**
 * AudioEngine — singleton playback engine (ARCHITECTURE.md §10).
 *
 * Howler (html5 streaming) + Web Audio graph:
 *
 *   slot.mediaSource ─▶ trim (ReplayGain) ─▶ fade (crossfade) ─┐
 *   slot.mediaSource ─▶ trim ─────────────▶ fade ──────────────┤
 *                                                              ▼
 *                            eqInput ─▶ 10× BiquadFilter (peaking, EQ_BANDS_HZ)
 *                                   ─▶ master (volume, smooth ramps)
 *                                   ─▶ analyser (spectrum/visualizer)
 *                                   ─▶ destination
 *
 * - Dual slots enable gapless preload (`preloadNext`) and N-second crossfades.
 * - ReplayGain: per-slot trim GainNode from track.loudnessLufs → −14 LUFS target.
 * - HLS (.m3u8): native <audio> on Safari, hls.js elsewhere (lazy-imported).
 * - Web Audio requires CORS-clean audio (`crossOrigin=anonymous` + ACAO headers
 *   from the API/R2). If the graph cannot be built, playback still works —
 *   EQ/visualizer simply disable themselves.
 *
 * Typed events (`on`) are consumed exclusively by `stores/playerStore.ts`.
 */
import { Howl, Howler } from 'howler';
import { EQ_BANDS_HZ, dbToLinear, replayGainDb, type TrackDto } from '@aurial/shared';
import { resolveMediaUrl } from '@/lib/api';
import { clamp } from '@/lib/utils';
import type HlsType from 'hls.js';

/**
 * Why an `error` event fired — the consumer decides what is retryable:
 * - 'source': the track has no resolvable source at all;
 * - 'load':   the chosen source failed to load/decode (dead URL, 404/403, CDN
 *             down) — trying an ALTERNATIVE source may succeed;
 * - 'play':   the browser blocked playback (autoplay policy) — the source is
 *             fine, only a user gesture is missing.
 */
export type PlaybackErrorKind = 'source' | 'load' | 'play';

export interface AudioEngineEventMap {
  /** Emitted at rAF rate while playing (throttle on the consumer side). */
  timeupdate: { position: number; duration: number };
  loaded: { track: TrackDto; duration: number };
  ended: { track: TrackDto | null };
  error: { message: string; track: TrackDto | null; kind: PlaybackErrorKind };
  buffering: { buffering: boolean };
}

export interface LoadOptions {
  autoplay?: boolean;
  /** Crossfade duration in seconds (0 = hard cut / gapless). */
  crossfadeSeconds?: number;
}

type SlotSource =
  { kind: 'howl'; howl: Howl } | { kind: 'element'; el: HTMLAudioElement; hls: HlsType | null };

interface Slot {
  source: SlotSource | null;
  /** Underlying media element once known (Howler node or owned element). */
  el: HTMLAudioElement | null;
  track: TrackDto | null;
  loaded: boolean;
  fade: GainNode | null;
  trim: GainNode | null;
  mediaSource: MediaElementAudioSourceNode | null;
  cleanup: Array<() => void>;
  /** Monotonic sequence guarding stale async callbacks after resets. */
  seq: number;
}

type SlotIndex = 0 | 1;

interface HowlInternals {
  _sounds: Array<{ _node?: HTMLAudioElement }>;
}

interface HowlerInternals {
  _html5AudioPool?: HTMLAudioElement[];
}

/** createMediaElementSource is once-per-element; Howler pools elements. */
const mediaSourceCache = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/**
 * iOS suspends the AudioContext when the screen locks or the PWA leaves the
 * foreground — ANY audio routed through Web Audio goes silent. On iPhone/iPad
 * we skip the graph entirely (no EQ/visualizer there) so playback stays on the
 * bare <audio> element, which iOS keeps playing in the background with
 * Media Session lock-screen controls.
 */
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const PLAYBACK_ERROR = 'Não foi possível reproduzir esta faixa.';

function createSlot(): Slot {
  return {
    source: null,
    el: null,
    track: null,
    loaded: false,
    fade: null,
    trim: null,
    mediaSource: null,
    cleanup: [],
    seq: 0,
  };
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url);
}

export class AudioEngine {
  private static _instance: AudioEngine | null = null;

  static getInstance(): AudioEngine {
    return (AudioEngine._instance ??= new AudioEngine());
  }

  private constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibility);
    }
  }

  // ── Web Audio graph ────────────────────────────────────────────
  private ctx: AudioContext | null = null;
  private webAudioFailed = false;
  private eqInput: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private master: GainNode | null = null;
  private _analyser: AnalyserNode | null = null;

  // ── Slots ──────────────────────────────────────────────────────
  private slots: [Slot, Slot] = [createSlot(), createSlot()];
  private activeIndex: SlotIndex = 0;

  // ── State ──────────────────────────────────────────────────────
  /** Resolves an offline/local source URL for a track, if one is cached. */
  private localResolver: ((track: TrackDto) => string | null) | null = null;
  private playing = false;
  private volume = 1;
  private muted = false;
  private rate = 1;
  private eqEnabled = false;
  private eqGains: readonly number[] = EQ_BANDS_HZ.map(() => 0);
  private normalize = true;
  private rafId: number | null = null;
  private hiddenTicker: ReturnType<typeof setInterval> | null = null;
  private fadeTimers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;

  private listeners: {
    [K in keyof AudioEngineEventMap]: Set<(p: AudioEngineEventMap[K]) => void>;
  } = {
    timeupdate: new Set(),
    loaded: new Set(),
    ended: new Set(),
    error: new Set(),
    buffering: new Set(),
  };

  /** AnalyserNode for spectrum visualizers — null until first playback / if Web Audio failed. */
  get analyser(): AnalyserNode | null {
    return this._analyser;
  }

  get currentTrack(): TrackDto | null {
    return this.active.track;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  // ── Events ─────────────────────────────────────────────────────

  on<K extends keyof AudioEngineEventMap>(
    event: K,
    listener: (payload: AudioEngineEventMap[K]) => void,
  ): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  off<K extends keyof AudioEngineEventMap>(
    event: K,
    listener: (payload: AudioEngineEventMap[K]) => void,
  ): void {
    this.listeners[event].delete(listener);
  }

  private emit<K extends keyof AudioEngineEventMap>(
    event: K,
    payload: AudioEngineEventMap[K],
  ): void {
    for (const listener of this.listeners[event]) listener(payload);
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Register a resolver that returns a cached/offline source URL for a track
   * (e.g. a blob: URL of a downloaded file). Used before the network stream.
   */
  setLocalSourceResolver(resolver: ((track: TrackDto) => string | null) | null): void {
    this.localResolver = resolver;
  }

  /** Local (offline) source if available, else the network stream URL. */
  private sourceFor(track: TrackDto): string | null {
    return this.localResolver?.(track) ?? track.streamUrl ?? null;
  }

  /** Load a track into the engine, optionally crossfading from the current one. */
  load(track: TrackDto, options: LoadOptions = {}): void {
    if (this.destroyed) return;
    const { autoplay = true, crossfadeSeconds = 0 } = options;
    const source = this.sourceFor(track);
    if (!source) {
      this.emit('error', { message: 'Faixa indisponível para reprodução.', track, kind: 'source' });
      return;
    }
    const url = resolveMediaUrl(source);
    this.ensureGraph();
    void this.ctx?.resume().catch(() => undefined);

    const fromIndex = this.activeIndex;
    const toIndex: SlotIndex = fromIndex === 0 ? 1 : 0;
    const from = this.slots[fromIndex];
    const to = this.slots[toIndex];

    const preloaded = to.track?.id === track.id && to.source !== null;
    if (preloaded) {
      to.track = track; // refresh DTO (isLiked etc.)
    } else {
      this.resetSlot(to);
      this.prepareSlot(to, track, url);
    }

    const canCrossfade =
      crossfadeSeconds > 0 && this.ctx !== null && this.playing && from.track !== null;

    this.activeIndex = toIndex;

    if (canCrossfade) {
      this.setFade(to, 0);
      this.startSlot(to);
      this.rampFade(to, 1, crossfadeSeconds);
      this.rampFade(from, 0, crossfadeSeconds);
      const fromSeq = from.seq; // guard: skip cleanup if the slot was reused meanwhile
      const timer = setTimeout(
        () => {
          this.fadeTimers.delete(timer);
          if (from.seq === fromSeq) this.resetSlot(from);
        },
        crossfadeSeconds * 1000 + 120,
      );
      this.fadeTimers.add(timer);
      this.playing = true;
    } else {
      this.resetSlot(from);
      this.setFade(to, 1);
      if (autoplay) this.startSlot(to);
      this.playing = autoplay;
    }

    this.applyRate(to);
    this.applyTrim(to);
    this.syncTicker();
    this.emit('timeupdate', { position: 0, duration: track.durationMs / 1000 });
  }

  play(): void {
    if (this.destroyed || !this.active.source) return;
    void this.ctx?.resume().catch(() => undefined);
    this.startSlot(this.active);
    this.playing = true;
    this.syncTicker();
  }

  pause(): void {
    const slot = this.active;
    if (slot.source?.kind === 'howl') slot.source.howl.pause();
    else slot.source?.el.pause();
    this.playing = false;
    this.syncTicker();
  }

  stop(): void {
    this.pause();
    this.seek(0);
  }

  seek(seconds: number): void {
    const slot = this.active;
    const target = Math.max(0, seconds);
    if (slot.source?.kind === 'howl') slot.source.howl.seek(target);
    else if (slot.source) slot.source.el.currentTime = target;
    this.emit('timeupdate', { position: target, duration: this.getDuration() });
  }

  getPosition(): number {
    const slot = this.active;
    if (slot.source?.kind === 'howl') {
      const pos = slot.source.howl.seek();
      return typeof pos === 'number' ? pos : 0;
    }
    return slot.source?.el.currentTime ?? 0;
  }

  getDuration(): number {
    const slot = this.active;
    let duration = 0;
    if (slot.source?.kind === 'howl') duration = slot.source.howl.duration();
    else if (slot.source) duration = slot.source.el.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      duration = slot.track ? slot.track.durationMs / 1000 : 0;
    }
    return duration;
  }

  /** End of the buffered range containing the playhead (seconds) — seek-bar underlay. */
  getBufferedEnd(): number {
    const el = this.active.el;
    if (!el) return 0;
    const position = this.getPosition();
    try {
      for (let i = 0; i < el.buffered.length; i++) {
        if (el.buffered.start(i) <= position && position <= el.buffered.end(i)) {
          return el.buffered.end(i);
        }
      }
    } catch {
      /* buffered ranges may throw mid-load */
    }
    return 0;
  }

  /** 0..1 with a smooth ~80ms ramp (no zipper noise). */
  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  /** 0.5..2 playback rate (pitch preserved). */
  setRate(rate: number): void {
    this.rate = clamp(rate, 0.5, 2);
    for (const slot of this.slots) this.applyRate(slot);
  }

  /**
   * Preload the next queue item into the idle slot (gapless).
   * Call with null to release the idle slot.
   */
  preloadNext(track: TrackDto | null): void {
    if (this.destroyed) return;
    const idle = this.slots[this.activeIndex === 0 ? 1 : 0];
    if (!track) {
      if (idle.track) this.resetSlot(idle);
      return;
    }
    const source = this.sourceFor(track);
    if (idle.track?.id === track.id || !source) return;
    this.resetSlot(idle);
    this.prepareSlot(idle, track, resolveMediaUrl(source));
  }

  /** 10-band EQ (dB gains aligned with EQ_BANDS_HZ). Disabled = flat, zero cost. */
  setEq(options: { enabled: boolean; gains: readonly number[] }): void {
    this.eqEnabled = options.enabled;
    this.eqGains = options.gains;
    this.applyEq();
  }

  /** Toggle ReplayGain loudness normalization (target −14 LUFS). */
  setNormalizeVolume(enabled: boolean): void {
    this.normalize = enabled;
    for (const slot of this.slots) this.applyTrim(slot);
  }

  destroy(): void {
    this.destroyed = true;
    for (const timer of this.fadeTimers) clearTimeout(timer);
    this.fadeTimers.clear();
    for (const slot of this.slots) this.resetSlot(slot);
    this.stopTicker();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this._analyser = null;
    for (const set of Object.values(this.listeners)) set.clear();
    AudioEngine._instance = null;
  }

  // ── Graph ──────────────────────────────────────────────────────

  private ensureGraph(): void {
    if (this.ctx || this.webAudioFailed || typeof window === 'undefined') return;
    if (IS_IOS) {
      // Bare <audio> path — background/lock-screen playback beats EQ on iOS.
      this.webAudioFailed = true;
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.eqInput = ctx.createGain();
      this.eqFilters = EQ_BANDS_HZ.map((hz) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = hz;
        filter.Q.value = 1.0;
        filter.gain.value = 0;
        return filter;
      });
      this.master = ctx.createGain();
      this._analyser = ctx.createAnalyser();
      this._analyser.fftSize = 2048;
      this._analyser.smoothingTimeConstant = 0.8;

      let node: AudioNode = this.eqInput;
      for (const filter of this.eqFilters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(this.master);
      this.master.connect(this._analyser);
      this._analyser.connect(ctx.destination);
      this.master.gain.value = this.effectiveVolume();
      this.applyEq();
    } catch {
      // TODO: hls.js fallback path also lands here on very old browsers.
      this.webAudioFailed = true;
      this.ctx = null;
    }
  }

  private slotNodes(slot: Slot): { trim: GainNode; fade: GainNode } | null {
    if (!this.ctx || !this.eqInput) return null;
    if (!slot.trim || !slot.fade) {
      slot.trim = this.ctx.createGain();
      slot.fade = this.ctx.createGain();
      slot.trim.connect(slot.fade);
      slot.fade.connect(this.eqInput);
    }
    return { trim: slot.trim, fade: slot.fade };
  }

  private connectSlotElement(slot: Slot, el: HTMLAudioElement): void {
    slot.el = el;
    const nodes = this.slotNodes(slot);
    if (!this.ctx || !nodes) return;
    try {
      let source = mediaSourceCache.get(el);
      if (!source) {
        source = this.ctx.createMediaElementSource(el);
        mediaSourceCache.set(el, source);
      }
      source.disconnect();
      source.connect(nodes.trim);
      slot.mediaSource = source;
    } catch {
      // Tainted (no CORS) or already-claimed element: keep direct output.
      slot.mediaSource = null;
    }
  }

  // ── Slot lifecycle ─────────────────────────────────────────────

  private get active(): Slot {
    return this.slots[this.activeIndex];
  }

  private prepareSlot(slot: Slot, track: TrackDto, url: string): void {
    slot.track = track;
    slot.loaded = false;
    if (isHlsUrl(url)) void this.prepareElementSlot(slot, track, url);
    else this.prepareHowlSlot(slot, track, url);
  }

  private prepareHowlSlot(slot: Slot, track: TrackDto, url: string): void {
    const seq = ++slot.seq;
    this.primeHtml5Pool();

    const extension = /\.([a-z0-9]{2,5})(\?|#|$)/i.exec(url)?.[1]?.toLowerCase();
    const howl = new Howl({
      src: [url],
      html5: true, // stream instead of buffering the whole file
      preload: true,
      volume: this.ctx ? 1 : this.effectiveVolume(),
      // Signed URLs may carry no extension — hint the container format.
      format: extension ? [extension] : ['mp3'],
    });
    slot.source = { kind: 'howl', howl };

    howl.on('load', () => {
      if (slot.seq !== seq) return;
      slot.loaded = true;
      const el = (howl as unknown as HowlInternals)._sounds[0]?._node ?? null;
      if (el) {
        this.connectSlotElement(slot, el);
        this.attachBufferingEvents(slot, el, seq);
      }
      this.applyRate(slot);
      this.applyTrim(slot);
      if (slot === this.active) {
        this.emit('loaded', { track, duration: howl.duration() });
        this.emit('buffering', { buffering: false });
      }
    });
    howl.on('end', () => {
      if (slot.seq === seq && slot === this.active) this.handleEnded();
    });
    howl.on('loaderror', () => {
      if (slot.seq === seq && slot === this.active) {
        this.emit('error', { message: PLAYBACK_ERROR, track, kind: 'load' });
      }
    });
    howl.on('playerror', () => {
      if (slot.seq !== seq || slot !== this.active) return;
      // Retry once after the browser unlocks audio (autoplay policy).
      howl.once('unlock', () => {
        if (slot.seq === seq && this.playing) howl.play();
      });
    });
    slot.cleanup.push(() => howl.unload());
  }

  private async prepareElementSlot(slot: Slot, track: TrackDto, url: string): Promise<void> {
    const seq = ++slot.seq;
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    slot.source = { kind: 'element', el, hls: null };
    slot.el = el;

    const onMeta = (): void => {
      if (slot.seq !== seq) return;
      slot.loaded = true;
      this.applyRate(slot);
      this.applyTrim(slot);
      if (slot === this.active) {
        this.emit('loaded', { track, duration: el.duration });
        this.emit('buffering', { buffering: false });
      }
    };
    const onEnded = (): void => {
      if (slot.seq === seq && slot === this.active) this.handleEnded();
    };
    const onError = (): void => {
      if (slot.seq === seq && slot === this.active) {
        this.emit('error', { message: PLAYBACK_ERROR, track, kind: 'load' });
      }
    };
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    slot.cleanup.push(() => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      el.pause();
      el.removeAttribute('src');
      el.load();
    });
    this.attachBufferingEvents(slot, el, seq);
    this.connectSlotElement(slot, el);

    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = url; // Safari plays HLS natively
      return;
    }
    try {
      const { default: Hls } = await import('hls.js');
      if (slot.seq !== seq) return;
      if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 30, enableWorker: true });
        hls.loadSource(url);
        hls.attachMedia(el);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && slot.seq === seq && slot === this.active) {
            this.emit('error', { message: PLAYBACK_ERROR, track, kind: 'load' });
          }
        });
        if (slot.source?.kind === 'element') slot.source.hls = hls;
        slot.cleanup.push(() => hls.destroy());
      } else {
        el.src = url; // last resort — some browsers manage
      }
    } catch {
      el.src = url;
    }
  }

  private attachBufferingEvents(slot: Slot, el: HTMLAudioElement, seq: number): void {
    const emit = (buffering: boolean) => (): void => {
      if (slot.seq === seq && slot === this.active) this.emit('buffering', { buffering });
    };
    const onWaiting = emit(true);
    const onReady = emit(false);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onReady);
    el.addEventListener('canplay', onReady);
    slot.cleanup.push(() => {
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onReady);
      el.removeEventListener('canplay', onReady);
    });
  }

  private startSlot(slot: Slot): void {
    if (!slot.source) return;
    if (slot.source.kind === 'howl') {
      const { howl } = slot.source;
      if (!howl.playing()) howl.play();
    } else {
      void slot.source.el.play().catch(() => {
        if (slot === this.active) {
          this.emit('error', {
            message: 'Reprodução bloqueada pelo navegador — toque na página e tente novamente.',
            track: slot.track,
            kind: 'play',
          });
        }
      });
    }
  }

  private resetSlot(slot: Slot): void {
    slot.seq++;
    for (const dispose of slot.cleanup.splice(0)) {
      try {
        dispose();
      } catch {
        /* already gone */
      }
    }
    slot.mediaSource?.disconnect();
    slot.mediaSource = null;
    slot.source = null;
    slot.el = null;
    slot.track = null;
    slot.loaded = false;
    if (slot.fade && this.ctx) {
      slot.fade.gain.cancelScheduledValues(this.ctx.currentTime);
      slot.fade.gain.value = 1;
    }
  }

  // ── Gain application ───────────────────────────────────────────

  private effectiveVolume(): number {
    return this.muted ? 0 : this.volume;
  }

  private applyVolume(): void {
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(this.effectiveVolume(), now + 0.08);
      return;
    }
    for (const slot of this.slots) {
      if (slot.source?.kind === 'howl') slot.source.howl.volume(this.effectiveVolume());
      else if (slot.source) slot.source.el.volume = this.effectiveVolume();
    }
  }

  private applyRate(slot: Slot): void {
    if (slot.source?.kind === 'howl') {
      slot.source.howl.rate(this.rate);
    } else if (slot.source) {
      slot.source.el.playbackRate = this.rate;
    }
    const el = slot.el as (HTMLAudioElement & { preservesPitch?: boolean }) | null;
    if (el && 'preservesPitch' in el) el.preservesPitch = true;
  }

  private applyTrim(slot: Slot): void {
    const nodes = this.slotNodes(slot);
    if (!nodes) return;
    const lufs = slot.track?.loudnessLufs;
    nodes.trim.gain.value =
      this.normalize && typeof lufs === 'number' ? dbToLinear(replayGainDb(lufs)) : 1;
  }

  private applyEq(): void {
    this.eqFilters.forEach((filter, index) => {
      filter.gain.value = this.eqEnabled ? clamp(this.eqGains[index] ?? 0, -12, 12) : 0;
    });
  }

  private setFade(slot: Slot, value: number): void {
    const nodes = this.slotNodes(slot);
    if (!nodes || !this.ctx) return;
    const now = this.ctx.currentTime;
    nodes.fade.gain.cancelScheduledValues(now);
    nodes.fade.gain.setValueAtTime(value, now);
  }

  private rampFade(slot: Slot, target: number, seconds: number): void {
    const nodes = this.slotNodes(slot);
    if (!nodes || !this.ctx) {
      // Fallback without Web Audio: Howler's own fade.
      if (slot.source?.kind === 'howl') {
        slot.source.howl.fade(
          slot.source.howl.volume(),
          target * this.effectiveVolume(),
          seconds * 1000,
        );
      }
      return;
    }
    const now = this.ctx.currentTime;
    nodes.fade.gain.cancelScheduledValues(now);
    nodes.fade.gain.setValueAtTime(nodes.fade.gain.value, now);
    nodes.fade.gain.linearRampToValueAtTime(target, now + seconds);
  }

  // ── Ticker ─────────────────────────────────────────────────────

  private tick = (): void => {
    this.rafId = null;
    if (!this.playing) return;
    this.emit('timeupdate', { position: this.getPosition(), duration: this.getDuration() });
    this.rafId = requestAnimationFrame(this.tick);
  };

  private syncTicker(): void {
    if (this.playing) {
      this.rafId ??= requestAnimationFrame(this.tick);
      // rAF freezes in background tabs — keep a coarse heartbeat for
      // play-recording / gapless preload triggers.
      this.hiddenTicker ??= setInterval(() => {
        if (this.playing && document.hidden) {
          this.emit('timeupdate', { position: this.getPosition(), duration: this.getDuration() });
        }
      }, 1000);
    } else {
      this.stopTicker();
    }
  }

  private stopTicker(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.hiddenTicker !== null) clearInterval(this.hiddenTicker);
    this.hiddenTicker = null;
  }

  private handleVisibility = (): void => {
    if (!document.hidden) {
      // Some browsers suspend the AudioContext in the background — resume so
      // playback (and lock-screen controls) recover on return.
      if (this.playing) void this.ctx?.resume().catch(() => undefined);
      this.syncTicker();
    }
  };

  private handleEnded(): void {
    this.playing = false;
    this.syncTicker();
    this.emit('ended', { track: this.active.track });
  }

  /**
   * Howler creates pooled <audio> elements without crossOrigin, which taints
   * the Web Audio graph. Seed the pool with a CORS-enabled element so the
   * next Howl picks it up.
   */
  private primeHtml5Pool(): void {
    try {
      const pool = (Howler as unknown as HowlerInternals)._html5AudioPool;
      if (Array.isArray(pool)) {
        const el = new Audio();
        el.crossOrigin = 'anonymous';
        pool.push(el);
      }
    } catch {
      /* non-critical */
    }
  }
}

/** The one engine instance the whole app shares. */
export const audioEngine = AudioEngine.getInstance();
