import { Howl } from "howler";

import musicEvents from "./music.json";

/**
 * Entry of a vanilla `sounds.json` music event: either a streamed track
 * (identified by its hash on Mojang's resource CDN) or a nested event.
 */
type MusicEntry =
  | { name: string; hash: string; volume: number; weight: number }
  | { event: string; weight: number };

type MusicEvent = keyof typeof musicEvents;
const MUSIC_EVENTS: Record<MusicEvent, MusicEntry[]> = musicEvents;

/**
 * Vanilla resources are served by hash from the same CDN the launcher uses;
 * the tracks total ~250 MB so they are streamed on demand instead of bundled.
 */
const RESOURCE_CDN = "https://resources.download.minecraft.net";

/** Vanilla `Music` record: event, min/max ticks of silence between songs */
type Music = { event: MusicEvent; minDelay: number; maxDelay: number };

/** `Musics.createGameMusic`: 10-20 minutes of silence between tracks */
const CREATIVE: Music = {
  event: "music.creative",
  minDelay: 12000,
  maxDelay: 24000,
};

/** `MusicManager.nextSongDelay` initial value */
const STARTING_DELAY = 100;

/** Gain change per tick while fading in/out (~5 s for a full fade) */
const FADE_STEP = 0.01;

/** Ticks per second, `MusicManager.tick` runs on the client tick */
const TICK_RATE = 20;

/** `Mth.nextInt(random, min, max)`: inclusive on both ends */
const nextInt = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1));

/** `WeighedSoundEvents.getSound`: weighted pick, recursing into nested events */
const pickTrack = (
  event: MusicEvent
): { hash: string; volume: number; name: string } => {
  const entries = MUSIC_EVENTS[event];
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.floor(Math.random() * total);
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) {
      if ("event" in entry) return pickTrack(entry.event as MusicEvent);
      return entry;
    }
  }
  const last = entries[entries.length - 1];
  return "event" in last ? pickTrack(last.event as MusicEvent) : last;
};

/**
 * Background music scheduler modelled on vanilla `MusicManager`: after a
 * short initial delay a track plays once, then the manager waits a random
 * 10-20 minutes of silence before the next one. Tracks fade in when they
 * start and fade out/in when muted (pause menu).
 */
export class MusicManager {
  private current: Howl | null = null;
  private currentId = 0;
  private currentVolume = 1;
  private currentGain = 0;
  private targetGain = 1;
  private paused = false;
  private nextSongDelay = STARTING_DELAY;
  private tickAccumulator = 0;
  private unlocked = false;
  /** Name of the playing track, for the debug overlay */
  nowPlaying = "";

  constructor() {
    // Browsers only allow playback after a user gesture; hold the schedule
    // until then so the first song is not lost to a rejected `play()`
    const unlock = () => {
      this.unlocked = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  /** Fades the current track out (and back in) rather than cutting it */
  setMuted(muted: boolean) {
    this.targetGain = muted ? 0 : 1;
  }

  update(deltaTime: number) {
    if (!this.unlocked) return;
    this.tickAccumulator += Math.min(deltaTime, 1);
    while (this.tickAccumulator >= 1 / TICK_RATE) {
      this.tickAccumulator -= 1 / TICK_RATE;
      this.tick(CREATIVE);
    }
  }

  /** `MusicManager.tick` for a single situational music */
  private tick(music: Music) {
    if (this.current) {
      this.fade();
    } else if (this.nextSongDelay === Number.MAX_SAFE_INTEGER) {
      // The song ended (`!soundManager.isActive(currentMusic)`)
      this.nextSongDelay = nextInt(music.minDelay, music.maxDelay);
    }
    this.nextSongDelay = Math.min(this.nextSongDelay, music.maxDelay);
    if (!this.current && this.nextSongDelay-- <= 0) this.startPlaying(music);
  }

  private fade() {
    if (!this.current || this.currentGain === this.targetGain) return;
    this.currentGain =
      this.currentGain < this.targetGain
        ? Math.min(this.currentGain + FADE_STEP, this.targetGain)
        : Math.max(this.currentGain - FADE_STEP, this.targetGain);
    this.current.volume(this.currentVolume * this.currentGain, this.currentId);
    if (this.currentGain === 0 && !this.paused) {
      this.paused = true;
      this.current.pause(this.currentId);
    } else if (this.currentGain > 0 && this.paused) {
      this.paused = false;
      this.current.play(this.currentId);
    }
  }

  /** `MusicManager.startPlaying`: no further scheduling until the song ends */
  private startPlaying(music: Music) {
    const track = pickTrack(music.event);
    this.nowPlaying = track.name.split("/").pop() ?? track.name;
    this.currentVolume = track.volume;
    this.currentGain = 0;
    this.paused = false;
    this.current = new Howl({
      src: [`${RESOURCE_CDN}/${track.hash.slice(0, 2)}/${track.hash}`],
      format: ["ogg"],
      html5: true,
      volume: 0,
      onend: () => this.stop(),
      onloaderror: () => this.stop(),
      onplayerror: () => this.stop(),
    });
    this.currentId = this.current.play();
    this.nextSongDelay = Number.MAX_SAFE_INTEGER;
  }

  private stop() {
    if (!this.current) return;
    this.current.unload();
    this.current = null;
    this.nowPlaying = "";
  }
}
