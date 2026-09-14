export type WorldParams = {
  seed: number;
  terrain: {
    scale: number;
    magnitude: number;
    offset: number;
  };
  surface: {
    offset: number;
    magnitude: number;
  };
  bedrock: {
    offset: number;
    magnitude: number;
  };
  trees: {
    frequency: number;
    trunkHeight: {
      min: number;
      max: number;
    };
    canopy: {
      size: {
        min: number;
        max: number;
      };
    };
  };
  grass: {
    frequency: number;
    patchSize: number;
  };
  flowers: {
    frequency: number;
  };
};
