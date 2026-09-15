import { Howl, Howler } from "howler";

import type { SoundGroup } from "../Block/blocks";

import soundEvents from "./soundEvents.json";

/** Vanilla `sounds.json` events -> sound files under `public/sounds/` */
type SoundEvent = keyof typeof soundEvents;
const SOUND_EVENTS: Record<SoundEvent, string[]> = soundEvents;

/**
 * Vanilla `SoundType`: every group we use has volume 1 / pitch 1, and
 * `Block.playerWillDestroy` / `BlockItem.place` / `Entity.playStepSound`
 * derive the actual playback values from those.
 */
const SOUND_TYPE_VOLUME = 1;
const SOUND_TYPE_PITCH = 1;

/** Vanilla `SoundType` name for each of our block sound groups */
const SOUND_TYPE_NAME: Record<SoundGroup, string> = {
  grass: "grass",
  gravel: "gravel",
  stone: "stone",
  wood: "wood",
  sand: "sand",
  snow: "snow",
  cloth: "wool",
  glass: "glass",
};

Howler.volume(0.5);

class AudioManager {
  #howls = new Map<string, Howl>();

  constructor() {
    for (const files of Object.values(SOUND_EVENTS)) {
      for (const file of files) this.howl(file);
    }
  }

  private howl(file: string) {
    let howl = this.#howls.get(file);
    if (!howl) {
      howl = new Howl({ src: [`sounds/${file}.ogg`] });
      this.#howls.set(file, howl);
    }
    return howl;
  }

  /** Plays a random variant of a sound event (uniform, like vanilla `WeighedSoundEvents` with equal weights) */
  play(event: SoundEvent, volume = 1, pitch = 1) {
    const files = SOUND_EVENTS[event];
    const file = files[Math.floor(Math.random() * files.length)];
    const howl = this.howl(file);
    const id = howl.play();
    howl.volume(volume, id);
    howl.rate(pitch, id);
  }

  /** `Entity.playStepSound`: volume * 0.15, pitch */
  playStep(group: SoundGroup) {
    this.play(
      `block.${SOUND_TYPE_NAME[group]}.step` as SoundEvent,
      SOUND_TYPE_VOLUME * 0.15,
      SOUND_TYPE_PITCH
    );
  }

  /** `LevelRenderer.levelEvent(2001)` block-break: (volume + 1) / 2, pitch * 0.8 */
  playBreak(group: SoundGroup) {
    this.play(
      `block.${SOUND_TYPE_NAME[group]}.break` as SoundEvent,
      (SOUND_TYPE_VOLUME + 1) / 2,
      SOUND_TYPE_PITCH * 0.8
    );
  }

  /** `BlockItem.place`: (volume + 1) / 2, pitch * 0.8 */
  playPlace(group: SoundGroup) {
    this.play(
      `block.${SOUND_TYPE_NAME[group]}.place` as SoundEvent,
      (SOUND_TYPE_VOLUME + 1) / 2,
      SOUND_TYPE_PITCH * 0.8
    );
  }
}

const audioManager = new AudioManager();
export default audioManager;
