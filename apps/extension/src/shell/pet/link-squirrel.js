/**
 * Link flying squirrel — dependency-free sprite controller for the extension.
 * The content script attaches it to a plain <link-squirrel> Shadow DOM host;
 * Chrome's isolated world does not upgrade this host as a custom element.
 */

const DEFAULTS = Object.freeze({
  frameWidth: 320,
  frameHeight: 320,
  columns: 8,
  frames: 61,
  width: 96,
  openDuration: 680,
  closeDuration: 480,
  label: '打开领客助手',
});

/** Clamp a finite numeric progress value to [0, 1]. */
export function clampProgress(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

/** Original GIF's cubic sampling curve; applied once when the frames were baked. */
export function referenceEaseCubic(progress) {
  const value = clampProgress(progress);
  return value < .5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

/** Unmodified 32-sample timing/progress proof from the supplied GIF. */
export const ORIGINAL_REFERENCE_PROFILE = Object.freeze({
  frames: 32,
  closedFrame: 0,
  openFrame: 18,
  closedTerminalFrame: 31,
  sampleMs: 40,
  openDuration: 680,
  closeDuration: 480,
  cycleDurationMs: 4160,
  progress: Object.freeze([
    0,
    ...Array.from({ length: 18 }, (_, index) => referenceEaseCubic((index + 1) / 18)),
    ...Array.from({ length: 13 }, (_, index) => 1 - referenceEaseCubic((index + 1) / 13)),
  ]),
  durations: Object.freeze([900, ...Array(17).fill(40), 1200, ...Array(12).fill(40), 900]),
});

function withMidpoints(values) {
  return values.flatMap((value, index) => index === values.length - 1
    ? [value] : [value, (value + values[index + 1]) / 2]);
}

/** Same trajectory and timing, with one linear progress midpoint per 40 ms interval. */
export const REFERENCE_PROFILE = Object.freeze({
  frames: 61,
  closedFrame: 0,
  openFrame: 35,
  closedTerminalFrame: 60,
  sampleMs: 20,
  openDuration: 680,
  closeDuration: 480,
  cycleDurationMs: 4160,
  progress: Object.freeze([
    0,
    ...withMidpoints(ORIGINAL_REFERENCE_PROFILE.progress.slice(1, 19)),
    ...withMidpoints(ORIGINAL_REFERENCE_PROFILE.progress.slice(19)),
  ]),
  durations: Object.freeze([900, ...Array(34).fill(20), 1200, ...Array(24).fill(20), 900]),
});

/** Physical opening amount of a baked original-GIF frame, using a zero-based index. */
export function referenceProgressAt(index) {
  const frame = Math.min(REFERENCE_PROFILE.frames - 1, Math.max(0, Math.round(Number(index) || 0)));
  return REFERENCE_PROFILE.progress[frame];
}

/** Find the nearest physical pose on the requested branch of the reference GIF. */
export function referenceFrameAt(progress, direction = 'opening') {
  const value = clampProgress(progress);
  const start = direction === 'closing' ? REFERENCE_PROFILE.openFrame : 0;
  const end = direction === 'closing' ? REFERENCE_PROFILE.closedTerminalFrame : REFERENCE_PROFILE.openFrame;
  let nearest = start;
  for (let index = start + 1; index <= end; index += 1) {
    if (Math.abs(REFERENCE_PROFILE.progress[index] - value)
      < Math.abs(REFERENCE_PROFILE.progress[nearest] - value)) nearest = index;
  }
  return nearest;
}

/** Nearest frame: physical reference pose by default, or an explicit uniform atlas. */
export function frameAt(progress, frames = DEFAULTS.frames, profile = 'reference', direction = 'opening') {
  const count = Math.max(1, Math.floor(Number(frames) || 1));
  if (profile === 'reference' && count === REFERENCE_PROFILE.frames) return referenceFrameAt(progress, direction);
  return Math.round(clampProgress(progress) * (count - 1));
}

/** Adjacent sprite frames and their alpha interpolation weight. */
export function blendFramesAt(progress, frames = DEFAULTS.frames, profile = 'reference', direction = 'opening') {
  const count = Math.max(1, Math.floor(Number(frames) || 1));
  if (profile === 'reference' && count === REFERENCE_PROFILE.frames) {
    const frame = referenceFrameAt(progress, direction);
    return { from: frame, to: frame, mix: 0 };
  }
  const position = clampProgress(progress) * (count - 1);
  const from = Math.floor(position);
  return { from, to: Math.min(from + 1, count - 1), mix: position - from };
}

/** Smoothstep easing. Exported to make playback easy to reuse and test. */
export function easeInOut(progress) {
  const value = clampProgress(progress);
  return value * value * (3 - 2 * value);
}

/** Sample a transition without changing its start point or direction. */
export function transitionProgress(from, to, elapsed, duration) {
  const ratio = duration <= 0 ? 1 : clampProgress(elapsed / duration);
  return {
    progress: clampProgress(from + (to - from) * easeInOut(ratio)),
    done: ratio === 1,
  };
}

// The extension content script owns this controller. Chrome does not upgrade
// custom elements inside its isolated world, so it attaches to a normal host.
export class LinkSquirrel {
  static get observedAttributes() {
    return [
      'src', 'frame-width', 'frame-height', 'columns', 'frames', 'width',
      'open-duration', 'close-duration', 'disabled', 'open', 'mode', 'label', 'blend', 'profile',
    ];
  }

  constructor(host) {
    this.host = host;
    this._connected = false;
    this._reflecting = false;
    this._progress = this.host.hasAttribute('open') ? 1 : 0;
    this._target = this._progress;
    this._direction = 'opening';
    this._referenceIndex = this._progress ? REFERENCE_PROFILE.openFrame : REFERENCE_PROFILE.closedFrame;
    this._animation = null;
    this._resumeAnimation = false;
    this._raf = null;
    this._image = null;
    this._pendingImage = null;
    this._loadEpoch = 0;
    this._frame = -1;
    this._renderProgress = NaN;
    this._hovered = false;
    this._focused = false;
    this._lastPointerType = '';
    this._listeners = [];
    this._motionQuery = null;
    this._onAnimationFrame = this._onAnimationFrame.bind(this);
    this._onMotionChange = this._onMotionChange.bind(this);

    const shadow = this.host.attachShadow({ mode: 'open', delegatesFocus: true });
    shadow.innerHTML = `
      <style>
        :host {
          display: inline-block;
          width: var(--link-squirrel-width, 96px);
          vertical-align: middle;
          contain: layout style;
          -webkit-tap-highlight-color: transparent;
        }
        button {
          position: relative;
          display: block;
          width: 100%;
          padding: 0;
          border: 0;
          margin: 0;
          aspect-ratio: 1;
          background: transparent;
          border-radius: 24%;
          cursor: pointer;
          touch-action: manipulation;
          user-select: none;
          outline: none;
        }
        button:focus-visible {
          outline: 3px solid var(--link-squirrel-focus-color, #1878ec);
          outline-offset: 3px;
        }
        button:disabled { cursor: default; opacity: .55; }
        canvas { display: block; width: 100%; height: 100%; pointer-events: none; }
        .fallback {
          position: absolute;
          inset: 20%;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: #2788f5;
          box-shadow: inset 0 2px 3px #ffffff55, 0 4px 12px #0b56ad22;
          color: #fff;
          font: 700 20px/1 system-ui, sans-serif;
          pointer-events: none;
        }
        [hidden] { display: none !important; }
        @media (forced-colors: active) {
          button:focus-visible { outline-color: Highlight; }
          .fallback { border: 2px solid ButtonText; }
        }
      </style>
      <button part="button" type="button" aria-expanded="false">
        <canvas part="canvas" aria-hidden="true"></canvas>
        <span class="fallback" part="fallback" aria-hidden="true">L</span>
      </button>
    `;
    this._button = shadow.querySelector('button');
    this._canvas = shadow.querySelector('canvas');
    this._fallback = shadow.querySelector('.fallback');
    this._context = this._canvas.getContext('2d', { alpha: true });
    this._blendCanvas = (this.host.ownerDocument || document).createElement('canvas');
    this._blendContext = this._blendCanvas.getContext('2d', { alpha: true });
  }

  connectedCallback() {
    if (this._connected) return;
    this._connected = true;
    this._upgradeProperty('open');
    this._upgradeProperty('progress');
    this._upgradeProperty('disabled');
    this._upgradeProperty('blend');
    this._upgradeProperty('profile');
    this._upgradeProperty('frameIndex');
    this._applyGeometry();
    this._syncAccessibility();
    this._installListeners();
    this._motionQuery = typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (this._motionQuery?.addEventListener) {
      this._motionQuery.addEventListener('change', this._onMotionChange);
    } else {
      this._motionQuery?.addListener?.(this._onMotionChange);
    }
    if (this._image) this._render(true);
    else this._loadImage();
    // A disconnect can interrupt playback. Resume from the preserved pose.
    if (this._resumeAnimation && this._progress !== this._target) {
      this._resumeAnimation = false;
      this._setOpen(Boolean(this._target), 'reconnect');
    }
  }

  disconnectedCallback() {
    this._connected = false;
    this._sampleAnimation(performance.now());
    this._resumeAnimation = Boolean(this._animation);
    this._cancelAnimation();
    this._listeners.forEach(([type, handler]) => this._button.removeEventListener(type, handler));
    this._listeners = [];
    if (this._motionQuery?.removeEventListener) {
      this._motionQuery.removeEventListener('change', this._onMotionChange);
    } else {
      this._motionQuery?.removeListener?.(this._onMotionChange);
    }
    this._motionQuery = null;
    this._hovered = false;
    this._focused = false;
    this._lastPointerType = '';
    this._loadEpoch += 1;
    if (this._pendingImage) {
      this._pendingImage.onload = null;
      this._pendingImage.onerror = null;
      this._pendingImage = null;
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue || !this._button) return;
    if (name === 'open') {
      if (!this._reflecting) this._setOpen(newValue !== null, 'attribute');
      return;
    }
    if (name === 'src') {
      if (this._connected) this._loadImage();
      else this._image = null;
      return;
    }
    if (['frame-width', 'frame-height', 'columns', 'frames', 'width'].includes(name)) {
      if (name === 'frames') {
        this._sampleAnimation(performance.now());
        this._cancelAnimation();
        this._referenceIndex = referenceFrameAt(this._progress, this._direction);
      }
      this._applyGeometry();
      if (this._image && !this._validateSprite(this._image)) return;
      if (this._connected && !this._image && !this._pendingImage) this._loadImage();
      this._render(true);
      return;
    }
    if (name === 'disabled' || name === 'label') this._syncAccessibility();
    if (name === 'disabled' && this.disabled) {
      this._hovered = false;
      this._focused = false;
      this._setOpen(false, 'disabled');
    }
    if (name === 'mode') {
      this._hovered = false;
      this._focused = false;
    }
    if (name === 'blend') {
      const wasAnimating = Boolean(this._animation);
      const done = this._sampleAnimation(performance.now());
      this._render(true);
      if (wasAnimating && done) this._emitState('blend');
    }
    if (name === 'profile') {
      this._sampleAnimation(performance.now());
      this._cancelAnimation();
      this._referenceIndex = referenceFrameAt(this._progress, this._direction);
      this._render(true);
    }
  }

  get open() { return Boolean(this._target); }
  set open(value) { this._setOpen(Boolean(value), 'api'); }

  get progress() { return this._progress; }
  set progress(value) {
    this._resumeAnimation = false;
    this._cancelAnimation();
    this._progress = clampProgress(value);
    this._referenceIndex = referenceFrameAt(this._progress, this._direction);
    this._target = this._progress === 1 ? 1 : 0;
    this._reflectOpen();
    this._syncAccessibility();
    this._render(true);
    this._emitState('api-progress');
  }

  get disabled() { return this.host.hasAttribute('disabled'); }
  set disabled(value) { this.host.toggleAttribute('disabled', Boolean(value)); }

  get blend() { return this.host.getAttribute('blend') !== 'false'; }
  set blend(value) { this.host.setAttribute('blend', value ? 'true' : 'false'); }

  get profile() {
    return this.host.getAttribute('profile') !== 'uniform' && this._settings().frames === REFERENCE_PROFILE.frames
      ? 'reference' : 'uniform';
  }
  set profile(value) { this.host.setAttribute('profile', value === 'uniform' ? 'uniform' : 'reference'); }

  get frameIndex() {
    return this.profile === 'reference' ? Math.round(this._referenceIndex)
      : frameAt(this._progress, this._settings().frames, 'uniform');
  }
  set frameIndex(value) {
    this._resumeAnimation = false;
    this._cancelAnimation();
    const frames = this._settings().frames;
    const index = Math.min(frames - 1, Math.max(0, Math.round(Number(value) || 0)));
    if (this.profile === 'reference') {
      this._referenceIndex = index;
      this._direction = index > REFERENCE_PROFILE.openFrame ? 'closing' : 'opening';
      this._progress = referenceProgressAt(index);
    } else {
      this._progress = frames <= 1 ? 0 : index / (frames - 1);
    }
    this._target = this._progress === 1 ? 1 : 0;
    this._reflectOpen();
    this._syncAccessibility();
    this._render(true);
    this._emitState('api-frame');
  }

  get mode() { return this.host.getAttribute('mode') === 'manual' ? 'manual' : 'hover'; }
  set mode(value) { this.host.setAttribute('mode', value === 'manual' ? 'manual' : 'hover'); }

  get src() {
    return this.host.getAttribute('src') || '';
  }
  set src(value) {
    if (value == null || value === '') this.host.removeAttribute('src');
    else this.host.setAttribute('src', String(value));
  }

  get state() {
    if (this._animation) return this._target ? 'opening' : 'closing';
    if (this._progress === 0) return 'closed';
    if (this._progress === 1) return 'open';
    return 'paused';
  }

  openArms() { this._setOpen(true, 'api'); }
  closeArms() { this._setOpen(false, 'api'); }
  toggle() { this._setOpen(!this.open, 'api'); }
  setLabel(label) { this.host.setAttribute('label', label); this._syncAccessibility(); }
  focus(options) { this._button.focus(options); }
  click() { this._button.click(); }

  _upgradeProperty(name) {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const value = this[name];
      delete this[name];
      this[name] = value;
    }
  }

  _numberAttribute(name, fallback, min, max, integer = false) {
    const raw = this.host.getAttribute(name);
    if (raw === null || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) return fallback;
    return integer ? Math.floor(value) : value;
  }

  _settings() {
    return {
      frameWidth: this._numberAttribute('frame-width', DEFAULTS.frameWidth, 1, 4096, true),
      frameHeight: this._numberAttribute('frame-height', DEFAULTS.frameHeight, 1, 4096, true),
      columns: this._numberAttribute('columns', DEFAULTS.columns, 1, 2000, true),
      frames: this._numberAttribute('frames', DEFAULTS.frames, 1, 2000, true),
      width: this._numberAttribute('width', DEFAULTS.width, 1, 2048),
      openDuration: this._numberAttribute('open-duration', DEFAULTS.openDuration, 0, 60000),
      closeDuration: this._numberAttribute('close-duration', DEFAULTS.closeDuration, 0, 60000),
    };
  }

  _applyGeometry() {
    const settings = this._settings();
    this.host.style.setProperty('--link-squirrel-width', `${settings.width}px`);
    this._button.style.aspectRatio = `${settings.frameWidth} / ${settings.frameHeight}`;
    if (this._canvas.width !== settings.frameWidth) this._canvas.width = settings.frameWidth;
    if (this._canvas.height !== settings.frameHeight) this._canvas.height = settings.frameHeight;
    if (this._blendCanvas.width !== settings.frameWidth) this._blendCanvas.width = settings.frameWidth;
    if (this._blendCanvas.height !== settings.frameHeight) this._blendCanvas.height = settings.frameHeight;
    this._frame = -1;
    this._renderProgress = NaN;
  }

  _syncAccessibility() {
    this._button.disabled = this.disabled;
    this._button.setAttribute('aria-label', this.host.getAttribute('label') || DEFAULTS.label);
    this._button.setAttribute('aria-expanded', String(this.open));
  }

  _installListeners() {
    const listen = (type, handler) => {
      this._button.addEventListener(type, handler);
      this._listeners.push([type, handler]);
    };
    listen('pointerenter', (event) => {
      if (event.pointerType === 'touch' || this.disabled || this.mode !== 'hover') return;
      this._hovered = true;
      this._setOpen(true, 'hover');
    });
    listen('pointerleave', (event) => {
      if (event.pointerType === 'touch' || this.disabled || this.mode !== 'hover') return;
      this._hovered = false;
      if (!this._focused) this._setOpen(false, 'hover');
    });
    listen('pointerdown', (event) => {
      this._lastPointerType = event.pointerType || 'mouse';
      // Pointer focus must not keep the squirrel open after the pointer leaves.
      this._focused = false;
    });
    listen('focus', () => {
      if (this.disabled || this.mode !== 'hover' || this._lastPointerType) return;
      this._focused = true;
      this._setOpen(true, 'focus');
    });
    listen('blur', () => {
      this._focused = false;
      this._lastPointerType = '';
      if (!this.disabled && this.mode === 'hover' && !this._hovered) this._setOpen(false, 'blur');
    });
    listen('keydown', (event) => {
      if (event.key === 'Escape' && !this.disabled) {
        this._setOpen(false, 'escape');
        event.preventDefault();
      }
    });
    listen('click', (event) => {
      if (this.disabled) return;
      const input = event.detail === 0 ? 'keyboard'
        : (event.pointerType || this._lastPointerType) === 'touch' ? 'touch' : 'pointer';
      this._lastPointerType = '';
      if (input === 'touch' && this.mode === 'hover') this._setOpen(!this.open, 'touch');
      this._emit('link-activate', { open: this.open, progress: this.progress, input });
    });
  }

  _reflectOpen() {
    this._reflecting = true;
    this.host.toggleAttribute('open', this.open);
    this._reflecting = false;
  }

  _setOpen(value, reason) {
    this._resumeAnimation = false;
    const target = value ? 1 : 0;
    const now = performance.now();
    this._sampleAnimation(now);
    if (this._target === target && (this._animation || this._progress === target)) {
      this._reflectOpen();
      this._syncAccessibility();
      return;
    }
    this._cancelAnimation();
    this._target = target;
    this._direction = target ? 'opening' : 'closing';
    this._reflectOpen();
    this._syncAccessibility();
    const settings = this._settings();
    const fullDuration = target ? settings.openDuration : settings.closeDuration;
    if (this.profile === 'reference') {
      const terminal = target ? REFERENCE_PROFILE.openFrame : REFERENCE_PROFILE.closedTerminalFrame;
      if (!this._connected || this._motionQuery?.matches || fullDuration === 0) {
        this._referenceIndex = terminal;
        this._progress = target;
        this._render(true);
        this._emitState(reason);
        return;
      }
      // The first sample appears immediately; original checkpoints plus one
      // midpoint per interval advance at 20 ms, scaled only by duration.
      const firstSample = target ? 1 : REFERENCE_PROFILE.openFrame + 1;
      const start = Math.max(firstSample, referenceFrameAt(this._progress, this._direction));
      const intervals = terminal - firstSample;
      this._referenceIndex = start;
      this._progress = referenceProgressAt(start);
      this._render(true);
      if (start === terminal) {
        this._emitState(reason);
        return;
      }
      this._animation = {
        profile: 'reference', fromFrame: start, toFrame: terminal,
        started: now, stepMs: fullDuration / intervals, reason,
      };
      this._emitState(reason);
      this._raf = requestAnimationFrame(this._onAnimationFrame);
      return;
    }
    // Scale by remaining distance so mid-flight reversals do not replay a full cycle.
    const duration = fullDuration * Math.abs(target - this._progress);
    if (!this._connected || this._motionQuery?.matches || duration === 0) {
      this._progress = target;
      this._render(true);
      this._emitState(reason);
      return;
    }
    this._animation = { profile: 'uniform', from: this._progress, to: target, started: now, duration, reason };
    this._emitState(reason);
    this._raf = requestAnimationFrame(this._onAnimationFrame);
  }

  _sampleAnimation(now) {
    if (!this._animation) return false;
    const animation = this._animation;
    if (animation.profile === 'reference') {
      const elapsed = Math.max(0, now - animation.started);
      const coordinate = Math.min(animation.toFrame, animation.fromFrame + elapsed / animation.stepMs);
      // Linear sampling between the existing 20 ms checkpoints adds no new
      // easing or motion. Exact-index/manual poses remain single-frame draws.
      this._referenceIndex = this.blend ? coordinate : Math.floor(coordinate + 1e-9);
      const first = Math.floor(this._referenceIndex);
      const second = Math.min(animation.toFrame, first + 1);
      const mix = this._referenceIndex - first;
      this._progress = REFERENCE_PROFILE.progress[first] * (1 - mix)
        + REFERENCE_PROFILE.progress[second] * mix;
      this._render();
      const done = this._referenceIndex === animation.toFrame;
      if (done) this._animation = null;
      return done;
    }
    const sample = transitionProgress(animation.from, animation.to, now - animation.started, animation.duration);
    this._progress = sample.progress;
    this._render();
    if (sample.done) this._animation = null;
    return sample.done;
  }

  _onAnimationFrame(now) {
    this._raf = null;
    if (!this._connected || !this._animation) return;
    const reason = this._animation.reason;
    if (this._sampleAnimation(now)) this._emitState(reason);
    else this._raf = requestAnimationFrame(this._onAnimationFrame);
  }

  _cancelAnimation() {
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._animation = null;
  }

  _onMotionChange() {
    if (!this._motionQuery?.matches || !this._animation) return;
    this._cancelAnimation();
    this._progress = this._target;
    this._referenceIndex = this._target ? REFERENCE_PROFILE.openFrame : REFERENCE_PROFILE.closedTerminalFrame;
    this._render(true);
    this._emitState('reduced-motion');
  }

  _loadImage() {
    const epoch = ++this._loadEpoch;
    if (this._pendingImage) {
      this._pendingImage.onload = null;
      this._pendingImage.onerror = null;
    }
    this._image = null;
    this._frame = -1;
    this._renderProgress = NaN;
    this._context?.clearRect(0, 0, this._canvas.width, this._canvas.height);
    this._fallback.hidden = false;
    const image = new Image();
    this._pendingImage = image;
    image.decoding = 'async';
    const source = this.src;
    image.onload = () => {
      if (epoch !== this._loadEpoch || !this._connected) return;
      this._pendingImage = null;
      if (!this._validateSprite(image)) return;
      this._image = image;
      this._fallback.hidden = true;
      this._render(true);
      const { frames, columns, frameWidth, frameHeight } = this._settings();
      this._emit('link-ready', { src: source, frames, columns, frameWidth, frameHeight, profile: this.profile });
    };
    image.onerror = () => {
      if (epoch !== this._loadEpoch || !this._connected) return;
      this._pendingImage = null;
      this._showError('飞鼠图片加载失败，请检查 src 路径。', source);
    };
    image.src = source;
  }

  _validateSprite(image) {
    const { frameWidth, frameHeight, columns, frames } = this._settings();
    const neededColumns = Math.min(columns, frames);
    const neededRows = Math.ceil(frames / columns);
    if (!this._context || image.naturalWidth < neededColumns * frameWidth
      || image.naturalHeight < neededRows * frameHeight) {
      this._showError('精灵图尺寸与帧宽、帧高、列数或帧数不一致。', this.src);
      return false;
    }
    return true;
  }

  _showError(message, src) {
    this._image = null;
    this._frame = -1;
    this._renderProgress = NaN;
    this._fallback.hidden = false;
    this._context?.clearRect(0, 0, this._canvas.width, this._canvas.height);
    this._emit('link-error', { message, src });
  }

  _render(force = false) {
    if (!this._image || !this._context) return;
    const { frameWidth, frameHeight, columns, frames } = this._settings();
    const reference = this.profile === 'reference';
    const frame = reference ? Math.round(this._referenceIndex) : frameAt(this._progress, frames, 'uniform');
    const blend = this.blend && this._blendContext;
    if (!force && (blend ? this._progress === this._renderProgress : frame === this._frame)) return;
    this._frame = frame;
    this._renderProgress = this._progress;
    this._context.clearRect(0, 0, frameWidth, frameHeight);
    const drawFrame = (context, index) => context.drawImage(this._image,
      (index % columns) * frameWidth, Math.floor(index / columns) * frameHeight,
      frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
    const { from, to, mix } = reference ? {
      from: Math.floor(this._referenceIndex),
      to: Math.min(Math.floor(this._referenceIndex) + 1, REFERENCE_PROFILE.closedTerminalFrame),
      mix: this._referenceIndex - Math.floor(this._referenceIndex),
    } : blendFramesAt(this._progress, frames, 'uniform');
    if (!blend || mix === 0 || from === to) {
      drawFrame(this._context, blend ? from : frame);
      return;
    }
    const context = this._blendContext;
    context.clearRect(0, 0, frameWidth, frameHeight);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1 - mix;
    drawFrame(context, from);
    // 'lighter' adds premultiplied color and alpha. The two weights sum to 1,
    // so overlapping opaque pixels stay opaque instead of fading at mid-pose.
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = mix;
    drawFrame(context, to);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    this._context.drawImage(this._blendCanvas, 0, 0);
  }

  _emitState(reason) {
    this._emit('link-statechange', {
      open: this.open, progress: this.progress, frameIndex: this.frameIndex,
      state: this.state, reason, profile: this.profile,
    });
  }

  _emit(type, detail) {
    this.host.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

