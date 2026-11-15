/**
 * Jewellery 3D models available for live try-on, by try-on category and the
 * product SKU they belong to. A product shows "Try on" only if its SKU is
 * here (adding a model: compress it with `npm run models`, then add an
 * entry). Model URLs come from scripts/build-models.mjs (models.json).
 */
import MODELS from './models.json';

// Rings. the_ring_1_carat: CC-BY-4.0, commercial use allowed with credit.
export const RING_CATALOG = {
  'CELESTE-SOLITAIRE-RING': {
    url: MODELS.the_ring_1_carat,
    credit: '"The Ring: 1 carat" by Evan (sketchfab.com/Evanz), CC-BY-4.0',
    creditUrl: 'https://sketchfab.com/3d-models/the-ring-1-carat-378f6df2c4f444399b83db2037258470',
  },
};
export const RING_ALIASES = { solitaire: 'CELESTE-SOLITAIRE-RING' };
export const DEFAULT_RING_SKU = 'CELESTE-SOLITAIRE-RING';

// Earrings. lengthMm = real length
// from the hook's top to the bottom of the drop; sets the on-ear size.
export const EARRING_CATALOG = {
  'GOLDEN-BALL-CRYSTAL-DROP-EARRINGS': {
    url: MODELS.golden_ball_crystal_diamond_drop_earrings,
    lengthMm: 48,
    credit: '"Golden Ball Crystal Diamond Drop Earrings" by DineshThennarasan (sketchfab.com/dineshthennarasan), CC-BY-4.0',
    creditUrl: 'https://sketchfab.com/3d-models/golden-ball-crystal-diamond-drop-earrings-863d3b5c1a714cfb88dc01c7ea0fbcfe',
  },
};
export const DEFAULT_EARRING_SKU = 'GOLDEN-BALL-CRYSTAL-DROP-EARRINGS';

// Necklaces. lengthMm = real chain
// length (front arc that is visible on the wearer).
export const NECKLACE_CATALOG = {
  'GOLD-NECKLACE-CHAIN': {
    url: MODELS.gold_necklace__chain,
    lengthMm: 450,
    credit: '"Gold necklace / chain" by Mckai (sketchfab.com/Mckai), CC-BY-4.0',
    creditUrl: 'https://sketchfab.com/3d-models/gold-necklace-chain-8bb2ebea4fbd4a3a9b21cba9f5d5fdc8',
  },
};
export const DEFAULT_NECKLACE_SKU = 'GOLD-NECKLACE-CHAIN';

// Nose rings. diameterMm = real outer
// diameter of the ring; sets its size relative to the face.
export const NOSE_RING_CATALOG = {
  'POINTY-NOSE-RING': {
    url: MODELS.pointy_nose_ring,
    diameterMm: 9, // typical nostril hoop; was 12 (looked oversized)
    credit: '"Pointy Nose Ring" by Tiko (sketchfab.com/tikoavp), CC-BY-4.0',
    creditUrl: 'https://sketchfab.com/3d-models/pointy-nose-ring-c1edf8f97caa4b019aa57cbe24566e34',
  },
};
export const DEFAULT_NOSE_RING_SKU = 'POINTY-NOSE-RING';

/** try-on category -> SKUs that have a model. */
export const TRYON_SKUS = {
  ring: Object.keys(RING_CATALOG),
  earring: Object.keys(EARRING_CATALOG),
  necklace: Object.keys(NECKLACE_CATALOG),
  nose: Object.keys(NOSE_RING_CATALOG),
};
