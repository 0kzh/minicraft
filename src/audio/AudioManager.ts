import { Howl, Howler } from "howler";
import { sample } from "lodash";

import soundData from "./sounds.json";
import spriteData from "./sprite.json";

// TODO: remove this, add volume slider
Howler.volume(0.3);

class AudioManager {
  sprite: Howl;

  constructor() {
    this.sprite = this.loadSounds();
  }

  loadSounds() {
    return new Howl({
      src: ["/audio/sprite.webm", "/audio/sprite.mp3"],
      sprite: spriteData.sprite as any,
    });
  }

  play(name: string) {
    if (!(name in soundData)) {
      console.error(`Unknown sound: ${name}`);
      return;
    }

    // dig and step sounds have same names and need to be differentiated
    const prefix = name.split(".")[0] === "dig" ? "dig_" : "";

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const options = soundData[name]["sounds"];
    const soundName = prefix + sample<string>(options).split("/").pop();
    this.sprite.play(soundName);
  }
}

const audioManager = new AudioManager();
export default audioManager;
