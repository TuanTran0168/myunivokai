const SOLAR_SYSTEM_TEXTURE_BASE_PATH = "/textures/solar-system";

export const SUN_TEXTURE_URL = `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_sun.jpg`;
export const MILKY_WAY_SKYBOX_TEXTURE_URL = `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_stars_milky_way.jpg`;

export type PlanetTextureCatalogEntry = {
  planetStyleName: string;
  textureUrl: string;
  ringTextureUrl?: string;
  /** City lights on the night side, applied as an emissive map. */
  nightLightsTextureUrl?: string;
  /** Cloud layer drawn on a slightly larger shell rotating at its own speed. */
  cloudsTextureUrl?: string;
  normalMapTextureUrl?: string;
  /** Inverted water mask: oceans render glossy, land stays matte. */
  roughnessMapTextureUrl?: string;
  axialTiltRadians: number;
};

/**
 * Real solar-system surface textures (see ATTRIBUTION.md in the texture folder).
 * Personality planets are assigned an entry deterministically by index, so the
 * same world config always renders the same planet styles.
 * Axial tilts approximate the real planets (Uranus famously rolls on its side).
 */
export const PLANET_TEXTURE_CATALOG: PlanetTextureCatalogEntry[] = [
  {
    planetStyleName: "earth-like",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_earth_daymap.jpg`,
    nightLightsTextureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_earth_nightmap.jpg`,
    cloudsTextureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/4k_earth_clouds.jpg`,
    normalMapTextureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_earth_normal_map.png`,
    roughnessMapTextureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_earth_roughness_map.png`,
    axialTiltRadians: 0.41
  },
  {
    planetStyleName: "gas-giant",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_jupiter.jpg`,
    axialTiltRadians: 0.05
  },
  {
    planetStyleName: "ringed-giant",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_saturn.jpg`,
    ringTextureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/8k_saturn_ring_alpha.png`,
    axialTiltRadians: 0.47
  },
  {
    planetStyleName: "red-desert",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/4k_mars.jpg`,
    axialTiltRadians: 0.44
  },
  {
    planetStyleName: "ice-giant",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_neptune.jpg`,
    axialTiltRadians: 0.49
  },
  {
    planetStyleName: "rocky-cratered",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/4k_mercury.jpg`,
    axialTiltRadians: 0.01
  },
  {
    planetStyleName: "sideways-ice-giant",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/2k_uranus.jpg`,
    axialTiltRadians: 1.71
  },
  {
    planetStyleName: "volcanic-surface",
    textureUrl: `${SOLAR_SYSTEM_TEXTURE_BASE_PATH}/4k_venus_surface.jpg`,
    axialTiltRadians: 0.05
  }
];

export function planetTextureEntryForIndex(planetIndex: number): PlanetTextureCatalogEntry {
  return PLANET_TEXTURE_CATALOG[planetIndex % PLANET_TEXTURE_CATALOG.length];
}
