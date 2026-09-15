/** Frame time above which the render distance is stepped down (50 fps) */
const SLOW_FRAME = 20;
/** Frame time below which the render distance is stepped back up (~80 fps) */
const FAST_FRAME = 12.5;
/** Seconds of frames averaged before a decision */
const WINDOW = 3;
/** Seconds to wait after a change so the new ring of chunks can stream in */
const SETTLE = 5;
/** Frames longer than this are tab switches / stalls, not rendering cost */
const STALL = 250;
/** Never drop below this, however slow the machine */
export const MIN_ADAPTIVE_DISTANCE = 6;

/**
 * Measures how long frames actually take and grows or shrinks the render
 * distance to keep the game smooth, staying at or below the player's chosen
 * maximum. GPU/CPU detection up front is unreliable, so this just watches the
 * result: a window of slow frames shrinks the distance by one chunk, a window
 * of fast frames grows it back, with a settling period after each change.
 */
export class AdaptiveRenderDistance {
  /** Currently applied render distance */
  current: number;
  private sum = 0;
  private count = 0;
  private elapsed = 0;
  private settle = SETTLE;

  constructor(
    public max: number,
    private readonly onChange: (distance: number) => void
  ) {
    this.current = max;
  }

  /** New player-selected maximum; the effective distance never exceeds it */
  setMax(max: number) {
    this.max = max;
    this.reset();
    if (this.current > max) this.apply(max);
    else if (this.current < max) this.settle = 0;
  }

  /** Feed one frame's duration (seconds) */
  update(dt: number, ready: boolean) {
    const ms = dt * 1000;
    if (!ready || ms > STALL) {
      this.reset();
      return;
    }
    if (this.settle > 0) {
      this.settle -= dt;
      return;
    }
    this.sum += ms;
    this.count++;
    this.elapsed += dt;
    if (this.elapsed < WINDOW) return;

    const avg = this.sum / this.count;
    this.reset();
    if (avg > SLOW_FRAME && this.current > MIN_ADAPTIVE_DISTANCE) {
      this.apply(this.current - 1);
    } else if (avg < FAST_FRAME && this.current < this.max) {
      this.apply(this.current + 1);
    }
  }

  private apply(distance: number) {
    this.current = distance;
    this.settle = SETTLE;
    this.onChange(distance);
  }

  private reset() {
    this.sum = 0;
    this.count = 0;
    this.elapsed = 0;
  }
}
