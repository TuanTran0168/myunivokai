import { describe, expect, it } from "vitest";
import {
  ambientSoundscapeSignature,
  buildAmbientSoundscapeRecipe,
  SMALL_SPEAKER_BED_FLOOR_HERTZ,
  SMALL_SPEAKER_PRESENCE_FLOOR_HERTZ
} from "./ambientSoundscape";
import type { SceneConfig } from "./types";

const UNIVERSE_SCENE: SceneConfig = {
  seed: "seed-universe-001",
  theme: "cosmic-galaxy",
  postFX: { bloomIntensity: 1 }
};

function forestScene(overrides: Partial<SceneConfig> = {}): SceneConfig {
  return {
    seed: "seed-forest-001",
    sceneType: "forest",
    season: { kind: "summer" },
    lighting: { timeOfDay: "day" },
    weather: { kind: "clear", intensity: 0.5 },
    ...overrides
  };
}

describe("buildAmbientSoundscapeRecipe determinism", () => {
  it("returns an identical recipe for the same scene", () => {
    expect(buildAmbientSoundscapeRecipe(UNIVERSE_SCENE)).toEqual(buildAmbientSoundscapeRecipe(UNIVERSE_SCENE));
  });

  it("returns a different pad for a different seed", () => {
    const first = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE);
    const second = buildAmbientSoundscapeRecipe({ ...UNIVERSE_SCENE, seed: "seed-universe-002" });
    expect(second.droneVoices).not.toEqual(first.droneVoices);
  });

  it("builds a recipe for a missing scene instead of throwing", () => {
    const recipe = buildAmbientSoundscapeRecipe(undefined);
    expect(recipe.droneVoices.length).toBeGreaterThan(0);
    expect(recipe.masterGain).toBeGreaterThan(0);
  });
});

describe("family character", () => {
  it("gives the universe a lowpass rumble and the forest a bandpass wind", () => {
    expect(buildAmbientSoundscapeRecipe(UNIVERSE_SCENE).bedFilterType).toBe("lowpass");
    expect(buildAmbientSoundscapeRecipe(forestScene()).bedFilterType).toBe("bandpass");
  });

  it("pitches the forest pad above the universe pad", () => {
    const universeRoot = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE).droneVoices[0].frequencyHertz;
    const forestRoot = buildAmbientSoundscapeRecipe(forestScene()).droneVoices[0].frequencyHertz;
    expect(forestRoot).toBeGreaterThan(universeRoot);
  });

  it("separates universe themes", () => {
    const nebula = buildAmbientSoundscapeRecipe({ ...UNIVERSE_SCENE, theme: "nebula" });
    const crystal = buildAmbientSoundscapeRecipe({ ...UNIVERSE_SCENE, theme: "crystal" });
    expect(crystal.droneVoices[0].frequencyHertz).toBeGreaterThan(nebula.droneVoices[0].frequencyHertz);
    expect(crystal.droneFilterCutoffHertz).toBeGreaterThan(nebula.droneFilterCutoffHertz);
  });

  it("falls back to the default character for an unknown theme", () => {
    const { signature: _unknownSignature, ...unknown } = buildAmbientSoundscapeRecipe({
      ...UNIVERSE_SCENE,
      theme: "not-a-theme"
    });
    const { signature: _fallbackSignature, ...fallback } = buildAmbientSoundscapeRecipe({
      ...UNIVERSE_SCENE,
      theme: "cosmic-galaxy"
    });
    // The signatures differ by design — they carry the raw theme string so an
    // unknown theme still gets its own effect identity. The SOUND must match.
    expect(unknown).toEqual(fallback);
  });
});

describe("forest weather and light drive the bed", () => {
  it("makes rain louder and brighter than clear weather", () => {
    const clear = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "clear", intensity: 1 } }));
    const rain = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "rain", intensity: 1 } }));
    expect(rain.bedGain).toBeGreaterThan(clear.bedGain);
    expect(rain.bedFilterFrequencyHertz).toBeGreaterThan(clear.bedFilterFrequencyHertz);
    expect(rain.bedFilterQuality).toBeLessThan(clear.bedFilterQuality);
  });

  it("makes snow quieter and duller than clear weather", () => {
    const clear = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "clear", intensity: 1 } }));
    const snow = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "snow", intensity: 1 } }));
    expect(snow.bedGain).toBeLessThan(clear.bedGain);
    expect(snow.bedFilterFrequencyHertz).toBeLessThan(clear.bedFilterFrequencyHertz);
  });

  it("scales the weather effect by its intensity", () => {
    const lightRain = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "rain", intensity: 0.2 } }));
    const heavyRain = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "rain", intensity: 1 } }));
    expect(heavyRain.bedGain).toBeGreaterThan(lightRain.bedGain);
  });

  it("drops and dulls the pad from day to dusk", () => {
    const day = buildAmbientSoundscapeRecipe(forestScene({ lighting: { timeOfDay: "day" } }));
    const dusk = buildAmbientSoundscapeRecipe(forestScene({ lighting: { timeOfDay: "dusk" } }));
    expect(dusk.droneVoices[0].frequencyHertz).toBeLessThan(day.droneVoices[0].frequencyHertz);
    expect(dusk.droneFilterCutoffHertz).toBeLessThan(day.droneFilterCutoffHertz);
  });

  it("thins the voice stack in winter compared with summer", () => {
    const summer = buildAmbientSoundscapeRecipe(forestScene({ season: { kind: "summer" } }));
    const winter = buildAmbientSoundscapeRecipe(forestScene({ season: { kind: "winter" } }));
    expect(winter.droneVoices.length).toBeLessThanOrEqual(summer.droneVoices.length);
  });
});

describe("output stays inside safe audio bounds", () => {
  const HOSTILE_SCENES: SceneConfig[] = [
    {},
    { seed: "" },
    { seed: "hostile-1", theme: "crystal", postFX: { bloomIntensity: Number.NaN } },
    { seed: "hostile-2", theme: "crystal", postFX: { bloomIntensity: 9999 } },
    { seed: "hostile-3", theme: "crystal", postFX: { bloomIntensity: -50 } },
    { seed: "hostile-4", sceneType: "forest", weather: { kind: "rain", intensity: 42 } },
    { seed: "hostile-5", sceneType: "forest", weather: { kind: "rain", intensity: -3 } },
    { seed: "hostile-6", sceneType: "forest", weather: { kind: "unknown-weather", intensity: 1 } },
    { seed: "hostile-7", sceneType: "forest", lighting: { timeOfDay: "midnight" }, season: { kind: "monsoon" } }
  ];

  it.each(HOSTILE_SCENES.map((scene, index) => [index, scene] as const))(
    "keeps every value finite and bounded for hostile scene %i",
    (_index, scene) => {
      const recipe = buildAmbientSoundscapeRecipe(scene);

      expect(recipe.masterGain).toBeGreaterThan(0);
      expect(recipe.masterGain).toBeLessThanOrEqual(0.5);
      expect(recipe.bedGain).toBeGreaterThanOrEqual(0);
      expect(recipe.bedGain).toBeLessThanOrEqual(0.35);
      expect(recipe.droneFilterCutoffHertz).toBeGreaterThanOrEqual(90);
      expect(recipe.droneFilterCutoffHertz).toBeLessThanOrEqual(6000);
      expect(recipe.bedFilterFrequencyHertz).toBeGreaterThanOrEqual(90);
      expect(recipe.bedFilterFrequencyHertz).toBeLessThanOrEqual(6000);
      expect(recipe.bedFilterQuality).toBeGreaterThan(0);
      expect(recipe.bedSweepRateHertz).toBeGreaterThan(0);
      expect(recipe.droneVoices.length).toBeGreaterThanOrEqual(3);

      for (const voice of recipe.droneVoices) {
        expect(Number.isFinite(voice.frequencyHertz)).toBe(true);
        expect(voice.frequencyHertz).toBeGreaterThanOrEqual(30);
        expect(voice.frequencyHertz).toBeLessThanOrEqual(2000);
        expect(voice.gain).toBeGreaterThan(0);
        expect(voice.gain).toBeLessThanOrEqual(1);
        expect(voice.breathDepth).toBeGreaterThanOrEqual(0);
        expect(voice.breathDepth).toBeLessThanOrEqual(1);
        expect(voice.breathRateHertz).toBeGreaterThan(0);
        expect(Math.abs(voice.detuneCents)).toBeLessThanOrEqual(7);
      }
    }
  );

  it("keeps the summed drone gain under unity so the pad cannot clip", () => {
    const totalGain = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE).droneVoices.reduce(
      (runningTotal, voice) => runningTotal + voice.gain,
      0
    );
    expect(totalGain * buildAmbientSoundscapeRecipe(UNIVERSE_SCENE).masterGain).toBeLessThan(1);
  });
});

describe("audibility on small speakers", () => {
  // The regression this file exists to prevent. The first version of the recipe
  // put every universe voice between 47 and 106 Hz and lowpassed the bed to
  // 170-320 Hz. Every other test here passed, and the feature was silent on a
  // laptop, because nothing asked whether the output lands where a speaker can
  // reproduce it. A pad below roughly 150 Hz is a pad nobody hears.
  // Enough seeds to walk the rolled root/cutoff jitter rather than sample five
  // lucky points of it. The jitter is bounded at +/-6%, so the sweep reaching
  // the low end is what makes this a proof rather than a spot check.
  const AUDIBILITY_SEED_SUFFIXES = Array.from({ length: 40 }, (_unused, index) => `seed-${index}`);
  const EVERY_UNIVERSE_THEME = ["cosmic-galaxy", "nebula", "crystal", "aurora", "cyber-orbit"];
  const EVERY_FOREST_CONDITION: Array<Partial<SceneConfig>> = [
    { weather: { kind: "clear", intensity: 1 }, lighting: { timeOfDay: "day" } },
    { weather: { kind: "snow", intensity: 1 }, lighting: { timeOfDay: "dusk" } },
    { weather: { kind: "overcast", intensity: 1 }, lighting: { timeOfDay: "dusk" } },
    { weather: { kind: "rain", intensity: 1 }, lighting: { timeOfDay: "goldenHour" } }
  ];

  function expectAudibleOnSmallSpeakers(recipe: ReturnType<typeof buildAmbientSoundscapeRecipe>) {
    const highestVoiceHertz = Math.max(...recipe.droneVoices.map((voice) => voice.frequencyHertz));
    expect(highestVoiceHertz).toBeGreaterThanOrEqual(SMALL_SPEAKER_PRESENCE_FLOOR_HERTZ);
    expect(recipe.bedFilterFrequencyHertz).toBeGreaterThanOrEqual(SMALL_SPEAKER_BED_FLOOR_HERTZ);
  }

  it.each(EVERY_UNIVERSE_THEME)("keeps the %s pad above the small-speaker floor", (theme) => {
    for (const seedSuffix of AUDIBILITY_SEED_SUFFIXES) {
      expectAudibleOnSmallSpeakers(buildAmbientSoundscapeRecipe({ seed: `audible-${theme}-${seedSuffix}`, theme }));
    }
  });

  it.each(EVERY_FOREST_CONDITION.map((condition, index) => [index, condition] as const))(
    "keeps forest condition %i above the small-speaker floor",
    (index, condition) => {
      for (const seedSuffix of AUDIBILITY_SEED_SUFFIXES) {
        expectAudibleOnSmallSpeakers(
          buildAmbientSoundscapeRecipe({ seed: `audible-forest-${index}-${seedSuffix}`, sceneType: "forest", ...condition })
        );
      }
    }
  );

  it("keeps the darkest, quietest scene audible", () => {
    // Dusk drops the pad and snow closes the bed down — the two modifiers that
    // push hardest toward inaudible, applied together at full intensity.
    expectAudibleOnSmallSpeakers(
      buildAmbientSoundscapeRecipe({
        seed: "audible-worst-case",
        sceneType: "forest",
        weather: { kind: "snow", intensity: 1 },
        lighting: { timeOfDay: "dusk" },
        season: { kind: "winter" },
        postFX: { bloomIntensity: 0.2 }
      })
    );
  });
});

describe("the DNA reaches the ears", () => {
  function universeSceneWithPlanets(planetCount: number, energy: number): SceneConfig {
    return {
      seed: "dna-seed-001",
      theme: "aurora",
      planets: Array.from({ length: planetCount }, (_unused, planetIndex) => ({
        key: `planet-${planetIndex}`,
        name: `Planet ${planetIndex}`,
        energy
      }))
    };
  }

  it("widens the chord as the visitor's world gains planets", () => {
    const sparse = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(3, 50));
    const full = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(7, 50));
    expect(full.droneVoices.length).toBeGreaterThan(sparse.droneVoices.length);
  });

  it("caps the chord so a very busy world does not turn into a cluster", () => {
    const enormous = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(40, 50));
    expect(enormous.droneVoices.length).toBeLessThanOrEqual(5);
  });

  it("opens the pad and quickens its breathing with planet energy", () => {
    const calm = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(5, 10));
    const intense = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(5, 95));
    expect(intense.droneFilterCutoffHertz).toBeGreaterThan(calm.droneFilterCutoffHertz);
    expect(intense.droneVoices[0].breathRateHertz).toBeGreaterThan(calm.droneVoices[0].breathRateHertz);
  });

  it("reads forest landmarks the same way it reads planets", () => {
    const sparse = buildAmbientSoundscapeRecipe({
      seed: "dna-forest",
      sceneType: "forest",
      landmarks: [{ key: "a", energy: 50 }, { key: "b", energy: 50 }, { key: "c", energy: 50 }]
    });
    const full = buildAmbientSoundscapeRecipe({
      seed: "dna-forest",
      sceneType: "forest",
      landmarks: Array.from({ length: 6 }, (_unused, index) => ({ key: `landmark-${index}`, energy: 50 }))
    });
    expect(full.droneVoices.length).toBeGreaterThan(sparse.droneVoices.length);
  });

  it("still produces a chord for a scene with no points of interest yet", () => {
    const empty = buildAmbientSoundscapeRecipe({ seed: "dna-empty", theme: "aurora" });
    expect(empty.droneVoices.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ambientSoundscapeSignature", () => {
  it("stays stable for the same scene and changes with the seed", () => {
    expect(ambientSoundscapeSignature(UNIVERSE_SCENE)).toBe(ambientSoundscapeSignature(UNIVERSE_SCENE));
    expect(ambientSoundscapeSignature({ ...UNIVERSE_SCENE, seed: "other" })).not.toBe(
      ambientSoundscapeSignature(UNIVERSE_SCENE)
    );
  });

  it("changes when forest weather changes but not when an unrelated field does", () => {
    const base = forestScene();
    expect(ambientSoundscapeSignature(forestScene({ weather: { kind: "rain", intensity: 0.5 } }))).not.toBe(
      ambientSoundscapeSignature(base)
    );
    expect(ambientSoundscapeSignature({ ...base, sceneName: "renamed" })).toBe(ambientSoundscapeSignature(base));
  });

  it("matches the signature carried on the recipe", () => {
    expect(buildAmbientSoundscapeRecipe(UNIVERSE_SCENE).signature).toBe(ambientSoundscapeSignature(UNIVERSE_SCENE));
  });
});
