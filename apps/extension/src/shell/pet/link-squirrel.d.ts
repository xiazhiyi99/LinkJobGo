export type SquirrelState = 'closed' | 'opening' | 'open' | 'closing' | 'paused';
export interface SquirrelStateDetail {
  /** Requested end state; true while opening and when fully open. */
  open: boolean;
  /** Current pose, clamped to 0..1. */
  progress: number;
  /** Nearest zero-based displayed reference frame (0..60 by default). */
  frameIndex: number;
  state: SquirrelState;
  reason: string;
  profile: SquirrelProfile;
}
export interface SquirrelReadyDetail {
  src: string;
  frames: number;
  columns: number;
  frameWidth: number;
  frameHeight: number;
  profile: SquirrelProfile;
}
export interface SquirrelActivateDetail {
  open: boolean;
  progress: number;
  input: 'pointer' | 'touch' | 'keyboard';
}
export interface SquirrelErrorDetail { message: string; src: string }
export interface LinkSquirrelEventMap {
  'link-ready': CustomEvent<SquirrelReadyDetail>;
  'link-error': CustomEvent<SquirrelErrorDetail>;
  'link-statechange': CustomEvent<SquirrelStateDetail>;
  'link-activate': CustomEvent<SquirrelActivateDetail>;
}

export type SquirrelProfile = 'reference' | 'uniform';
export type SquirrelDirection = 'opening' | 'closing';
export declare const ORIGINAL_REFERENCE_PROFILE: Readonly<{
  frames: 32;
  closedFrame: 0;
  openFrame: 18;
  closedTerminalFrame: 31;
  sampleMs: 40;
  openDuration: 680;
  closeDuration: 480;
  cycleDurationMs: 4160;
  progress: readonly number[];
  durations: readonly number[];
}>;
export declare const REFERENCE_PROFILE: Readonly<{
  frames: 61;
  closedFrame: 0;
  openFrame: 35;
  closedTerminalFrame: 60;
  sampleMs: 20;
  openDuration: 680;
  closeDuration: 480;
  cycleDurationMs: 4160;
  progress: readonly number[];
  durations: readonly number[];
}>;
export declare function clampProgress(value: number | string): number;
export declare function referenceEaseCubic(progress: number): number;
export declare function referenceProgressAt(index: number): number;
export declare function referenceFrameAt(progress: number, direction?: SquirrelDirection): number;
/** Physical reference pose by default; other frame counts use a uniform atlas. */
export declare function frameAt(progress: number, frames?: number, profile?: SquirrelProfile, direction?: SquirrelDirection): number;
/** Reference profile returns one baked frame, mix=0. Uniform can blend adjacent frames. */
export declare function blendFramesAt(progress: number, frames?: number, profile?: SquirrelProfile, direction?: SquirrelDirection): {
  from: number;
  to: number;
  mix: number;
};
export declare function easeInOut(progress: number): number;
export declare function transitionProgress(from: number, to: number, elapsed: number, duration: number): {
  progress: number;
  /** Set an exact zero-based sample and pause; reference 35=open, 60=closed. */
  frameIndex: number;
  done: boolean;
};

export declare class LinkSquirrel {
  constructor(host: HTMLElement);
  readonly host: HTMLElement;
  connectedCallback(): void;
  disconnectedCallback(): void;
  /** Assign true/false to animate to that end pose. Reflects the `open` attribute. */
  open: boolean;
  /** Set a still pose and stop playback. Partial poses set `open` to false. */
  progress: number;
  disabled: boolean;
  /** Default true. Reference playback linearly samples adjacent 20ms frames. False steps at 50fps. */
  blend: boolean;
  /** Defaults to reference; frame counts other than 61 fall back to uniform. */
  profile: SquirrelProfile;
  /** manual disables automatic hover, focus and touch toggling. */
  mode: 'hover' | 'manual';
  /** Defaults to ../assets/squirrel-motion.webp, 61 x 320px frames, 8 columns. */
  src: string;
  readonly state: SquirrelState;
  openArms(): void;
  closeArms(): void;
  toggle(): void;
  setLabel(label: string): void;
  focus(options?: FocusOptions): void;
  click(): void;
  addEventListener<K extends keyof LinkSquirrelEventMap>(
    type: K,
    listener: (this: LinkSquirrel, event: LinkSquirrelEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

