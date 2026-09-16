export type WorldParams = {
  seed: number;
  terrain: {
    /** Water fills every column up to this height */
    seaLevel: number;
    /** Wavelength (blocks) of the continent / ocean mask */
    continentScale: number;
    /** Wavelength of the erosion field: low erosion = rugged, high = flat */
    erosionScale: number;
    /** Wavelength of the ridged peaks-and-valleys field */
    ridgeScale: number;
    /** Wavelength of small surface detail */
    detailScale: number;
    /** Wavelength of the temperature / humidity fields that pick biomes */
    biomeScale: number;
    /** Wavelength of the river network */
    riverScale: number;
    rivers: boolean;
    /** Multiplies the height of hills and mountains */
    amplitude: number;
  };
  caves: {
    enabled: boolean;
    /** Wavelength of the large-cavern (cheese) noise */
    cheeseScale: number;
    /** Density above which cheese caves are carved (higher = fewer) */
    cheeseThreshold: number;
    /** Wavelength of the tunnel (spaghetti) noise */
    spaghettiScale: number;
    /** Tunnel radius in noise space */
    spaghettiRadius: number;
    /** Offset added to the entrance noise; higher opens more cave mouths */
    entranceThreshold: number;
    /** Carved cells at or below this height fill with lava */
    lavaLevel: number;
    ravines: boolean;
    entrances: boolean;
  };
  /** Multipliers on the per-biome defaults */
  trees: {
    density: number;
  };
  vegetation: {
    density: number;
  };
  ores: {
    density: number;
  };
};
