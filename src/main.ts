import "./style.scss";

import Game from "./Game";

declare global {
  interface Window {
    /** Dev-only handle for poking at the running game from the console */
    game?: Game;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const game = new Game();
  if (import.meta.env.DEV) window.game = game;
});
