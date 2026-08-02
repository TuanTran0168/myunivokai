import { describe, expect, it } from "vitest";
import {
  ambientSoundscapeSignature,
  buildAmbientSoundscapeRecipe,
  SMALL_SPEAKER_BED_FLOOR_HERTZ,
  SMALL_SPEAKER_MELODY_FLOOR_MIDI,
  SMALL_SPEAKER_ROOT_FLOOR_MIDI
} from "./ambientSoundscape";
import {
  midiNumberToFrequencyHertz,
  SAMPLED_INSTRUMENT_KEYS,
  SAMPLED_INSTRUMENT_NOTE_NAMES
} from "@/features/audio/instrumentSamples";
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

function universeSceneWithPlanets(planetCount: number, energy: number): SceneConfig {
  return {
    seed: "dna-seed-001",
    theme: "aurora",
    planets: Array.from({ length: planetCount }, (_unused, planetIndex) => ({
      key: `planet-${planetIndex}`,
      energy
    }))
  };
}

describe("determinism", () => {
  it("returns an identical recipe for the same scene", () => {
    expect(buildAmbientSoundscapeRecipe(UNIVERSE_SCENE)).toEqual(buildAmbientSoundscapeRecipe(UNIVERSE_SCENE));
  });

  it("returns a different performance for a different seed", () => {
    const first = buildAmbientSoundscapeRecipe(UNIVERSE_SCENE);
    const second = buildAmbientSoundscapeRecipe({ ...UNIVERSE_SCENE, seed: "seed-universe-002" });
    expect(second.performanceSeed).not.toBe(first.performanceSeed);
    expect(second.space).not.toEqual(first.space);
  });

  it("builds a recipe for a missing scene instead of throwing", () => {
    const recipe = buildAmbientSoundscapeRecipe(undefined);
    expect(recipe.melody.scaleSemitones.length).toBeGreaterThan(0);
    expect(recipe.masterGain).toBeGreaterThan(0);
  });
});

describe("instrument choice", () => {
  it("only ever names an instrument that has samples on disk", () => {
    const scenes: SceneConfig[] = [
      {},
      ...["cosmic-galaxy", "nebula", "crystal", "aurora", "cyber-orbit", "unknown"].map((theme) => ({
        seed: `theme-${theme}`,
        theme
      })),
      ...["clear", "sunRays", "overcast", "rain", "snow", "unknown"].map((kind) =>
        forestScene({ weather: { kind, intensity: 0.6 } })
      )
    ];
    for (const scene of scenes) {
      const recipe = buildAmbientSoundscapeRecipe(scene);
      expect(SAMPLED_INSTRUMENT_KEYS).toContain(recipe.melody.instrument);
      expect(SAMPLED_INSTRUMENT_KEYS).toContain(recipe.harmony.instrument);
    }
  });

  it("never doubles the melody timbre in the harmony", () => {
    for (const theme of ["cosmic-galaxy", "nebula", "crystal", "aurora", "cyber-orbit"]) {
      const recipe = buildAmbientSoundscapeRecipe({ seed: `pair-${theme}`, theme });
      expect(recipe.harmony.instrument).not.toBe(recipe.melody.instrument);
    }
  });

  it("gives each universe theme its own instrument and scale", () => {
    const crystal = buildAmbientSoundscapeRecipe({ ...UNIVERSE_SCENE, theme: "crystal" });
    const cyber = buildAmbientSoundscapeRecipe({ ...UNIVERSE_SCENE, theme: "cyber-orbit" });
    expect(crystal.melody.instrument).toBe("glockenspiel");
    expect(cyber.melody.instrument).toBe("saxello");
    expect(crystal.melody.scaleSemitones).not.toEqual(cyber.melody.scaleSemitones);
  });

  it("picks the forest instrument from the weather", () => {
    expect(buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "rain", intensity: 1 } })).melody.instrument).toBe(
      "recorder"
    );
    expect(buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "snow", intensity: 1 } })).melody.instrument).toBe(
      "glockenspiel"
    );
    expect(buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "clear", intensity: 1 } })).melody.instrument).toBe(
      "kalimba"
    );
  });

  it("picks the forest scale from the season", () => {
    const summer = buildAmbientSoundscapeRecipe(forestScene({ season: { kind: "summer" } }));
    const winter = buildAmbientSoundscapeRecipe(forestScene({ season: { kind: "winter" } }));
    const autumn = buildAmbientSoundscapeRecipe(forestScene({ season: { kind: "autumn" } }));
    expect(summer.melody.scaleSemitones).not.toEqual(winter.melody.scaleSemitones);
    expect(autumn.melody.scaleSemitones).not.toEqual(summer.melody.scaleSemitones);
  });

  it("keeps every scale sparse and consonant", () => {
    // Not semitone-free: kumoi and dorian each contain one minor second, which
    // is what gives them their character. What must not happen is a scale dense
    // enough that overlapping reverb tails turn into a cluster.
    const scenes = [
      UNIVERSE_SCENE,
      ...["nebula", "crystal", "aurora", "cyber-orbit"].map((theme) => ({ seed: theme, theme })),
      ...["spring", "summer", "autumn", "winter"].map((kind) => forestScene({ season: { kind } }))
    ];
    for (const scene of scenes) {
      const { scaleSemitones } = buildAmbientSoundscapeRecipe(scene).melody;
      expect(scaleSemitones.length).toBeGreaterThanOrEqual(5);
      expect(scaleSemitones.length).toBeLessThanOrEqual(6);
      expect(scaleSemitones[0]).toBe(0);
      expect(Math.max(...scaleSemitones)).toBeLessThan(12);

      let minorSecondCount = 0;
      for (let index = 1; index < scaleSemitones.length; index += 1) {
        const step = scaleSemitones[index] - scaleSemitones[index - 1];
        expect(step).toBeGreaterThan(0);
        if (step === 1) {
          minorSecondCount += 1;
        }
      }
      expect(minorSecondCount).toBeLessThanOrEqual(1);
    }
  });
});

describe("time of day transposes rather than detunes", () => {
  it("drops the key toward dusk and keeps it a whole number of semitones", () => {
    const day = buildAmbientSoundscapeRecipe(forestScene({ lighting: { timeOfDay: "day" } }));
    const golden = buildAmbientSoundscapeRecipe(forestScene({ lighting: { timeOfDay: "goldenHour" } }));
    const dusk = buildAmbientSoundscapeRecipe(forestScene({ lighting: { timeOfDay: "dusk" } }));

    expect(golden.melody.rootMidiNumber).toBeLessThan(day.melody.rootMidiNumber);
    expect(dusk.melody.rootMidiNumber).toBeLessThan(golden.melody.rootMidiNumber);
    expect(Number.isInteger(dusk.melody.rootMidiNumber)).toBe(true);
  });

  it("keeps the harmony exactly an octave under the melody", () => {
    for (const timeOfDay of ["day", "goldenHour", "dusk"]) {
      const recipe = buildAmbientSoundscapeRecipe(forestScene({ lighting: { timeOfDay } }));
      expect(recipe.melody.rootMidiNumber - recipe.harmony.rootMidiNumber).toBe(12);
    }
  });
});

describe("the DNA reaches the ears", () => {
  it("widens the harmony chord as the visitor's world gains planets", () => {
    const sparse = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(2, 50));
    const full = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(6, 50));
    expect(full.harmony.chordSemitones.length).toBeGreaterThanOrEqual(sparse.harmony.chordSemitones.length);
  });

  it("caps the chord so a very busy world does not turn into a cluster", () => {
    const enormous = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(40, 50));
    expect(enormous.harmony.chordSemitones.length).toBeLessThanOrEqual(4);
  });

  it("plays more often and more brightly as planet energy rises", () => {
    const calm = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(5, 10));
    const intense = buildAmbientSoundscapeRecipe(universeSceneWithPlanets(5, 95));
    expect(intense.melody.minimumGapSeconds).toBeLessThan(calm.melody.minimumGapSeconds);
    expect(intense.toneCutoffHertz).toBeGreaterThan(calm.toneCutoffHertz);
  });

  it("still produces a chord for a scene with no points of interest yet", () => {
    const empty = buildAmbientSoundscapeRecipe({ seed: "dna-empty", theme: "aurora" });
    expect(empty.harmony.chordSemitones.length).toBeGreaterThanOrEqual(2);
  });
});

describe("forest weather drives the bed", () => {
  it("makes rain louder and brighter than clear weather", () => {
    const clear = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "clear", intensity: 1 } }));
    const rain = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "rain", intensity: 1 } }));
    expect(rain.bedGain).toBeGreaterThan(clear.bedGain);
    expect(rain.bedFilterFrequencyHertz).toBeGreaterThan(clear.bedFilterFrequencyHertz);
  });

  it("scales the weather effect by its intensity", () => {
    const light = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "rain", intensity: 0.2 } }));
    const heavy = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind: "rain", intensity: 1 } }));
    expect(heavy.bedGain).toBeGreaterThan(light.bedGain);
  });

  it("keeps the bed quiet enough to sit under the music", () => {
    // Rain once measured 52% of all rendered energy above 1200 Hz — hiss over
    // music rather than under it.
    for (const kind of ["clear", "sunRays", "overcast", "rain", "snow"]) {
      const recipe = buildAmbientSoundscapeRecipe(forestScene({ weather: { kind, intensity: 1 } }));
      expect(recipe.bedGain).toBeLessThan(recipe.melody.gain / 3);
    }
  });
});

describe("audibility on small speakers", () => {
  // The first version put every voice under 110 Hz: correct on studio monitors,
  // silent on the laptop and phone speakers people use, and every unit test
  // passed because none asked where the energy landed.
  const EVERY_SCENE: SceneConfig[] = [
    {},
    ...["cosmic-galaxy", "nebula", "crystal", "aurora", "cyber-orbit"].map((theme) => ({ seed: theme, theme })),
    ...["clear", "sunRays", "overcast", "rain", "snow"].flatMap((kind) =>
      ["day", "goldenHour", "dusk"].map((timeOfDay) =>
        forestScene({ weather: { kind, intensity: 1 }, lighting: { timeOfDay } })
      )
    )
  ];

  it.each(EVERY_SCENE.map((scene, index) => [index, scene] as const))(
    "keeps scene %i above the small-speaker floor",
    (_index, scene) => {
      const recipe = buildAmbientSoundscapeRecipe(scene);
      // The melody has to be heard as the tune, so it clears the higher floor.
      // The harmony only supports, and a recorded instrument's partials carry
      // it on a small speaker where a bare sine would vanish.
      expect(recipe.melody.rootMidiNumber).toBeGreaterThanOrEqual(SMALL_SPEAKER_MELODY_FLOOR_MIDI);
      expect(midiNumberToFrequencyHertz(recipe.melody.rootMidiNumber)).toBeGreaterThan(150);
      expect(recipe.harmony.rootMidiNumber).toBeGreaterThanOrEqual(SMALL_SPEAKER_ROOT_FLOOR_MIDI);
      expect(recipe.bedFilterFrequencyHertz).toBeGreaterThanOrEqual(SMALL_SPEAKER_BED_FLOOR_HERTZ);
    }
  );

  it("keeps the nominal melody range close to the sampled range", () => {
    // The graph folds anything further out by octaves, so this is a sanity
    // bound on the recipe rather than the guarantee — the guarantee is tested
    // against the graph.
    const MAXIMUM_STRETCH_SEMITONES = 18;
    for (const scene of EVERY_SCENE) {
      const recipe = buildAmbientSoundscapeRecipe(scene);
      const sampledMidiNumbers = SAMPLED_INSTRUMENT_NOTE_NAMES[recipe.melody.instrument].map((noteName) => {
        const isSharp = noteName[1] === "s";
        const octave = Number.parseInt(noteName.slice(isSharp ? 2 : 1), 10);
        const pitchClass = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[noteName[0]] ?? 0;
        return 60 + (octave - 4) * 12 + pitchClass + (isSharp ? 1 : 0);
      });
      const lowestSample = Math.min(...sampledMidiNumbers);
      const highestSample = Math.max(...sampledMidiNumbers);
      const lowestNote = recipe.melody.rootMidiNumber + Math.min(...recipe.chordProgression.rootOffsetsSemitones);
      const highestNote =
        recipe.melody.rootMidiNumber +
        Math.max(...recipe.chordProgression.rootOffsetsSemitones) +
        (recipe.melody.octaveCount - 1) * 12 +
        Math.max(...recipe.melody.scaleSemitones);

      expect(lowestNote).toBeGreaterThanOrEqual(lowestSample - MAXIMUM_STRETCH_SEMITONES);
      expect(highestNote).toBeLessThanOrEqual(highestSample + MAXIMUM_STRETCH_SEMITONES);
    }
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
      expect(recipe.masterGain).toBeLessThanOrEqual(1);
      expect(recipe.bedGain).toBeGreaterThanOrEqual(0);
      expect(recipe.bedGain).toBeLessThanOrEqual(0.14);
      expect(recipe.toneCutoffHertz).toBeGreaterThanOrEqual(900);
      expect(recipe.toneCutoffHertz).toBeLessThanOrEqual(12000);
      expect(recipe.bedFilterFrequencyHertz).toBeGreaterThanOrEqual(120);
      expect(recipe.bedFilterQuality).toBeGreaterThan(0);
      expect(recipe.bedSweepRateHertz).toBeGreaterThan(0);
      expect(Number.isInteger(recipe.melody.rootMidiNumber)).toBe(true);
      expect(recipe.melody.minimumGapSeconds).toBeGreaterThan(0);
      expect(recipe.melody.maximumGapSeconds).toBeGreaterThan(recipe.melody.minimumGapSeconds);
      expect(recipe.harmony.minimumGapSeconds).toBeGreaterThan(recipe.melody.maximumGapSeconds);
      expect(recipe.melody.graceNoteChance).toBeGreaterThanOrEqual(0);
      expect(recipe.melody.graceNoteChance).toBeLessThanOrEqual(1);
      expect(recipe.space.delayFeedback).toBeLessThan(1);
      expect(recipe.space.reverbWetMix).toBeLessThanOrEqual(1);
      expect(recipe.space.reverbDecaySeconds).toBeGreaterThan(0);
    }
  );

  it("keeps the delay feedback well short of self-oscillation", () => {
    for (const seedSuffix of Array.from({ length: 40 }, (_unused, index) => `feedback-${index}`)) {
      const recipe = buildAmbientSoundscapeRecipe({ seed: seedSuffix, theme: "aurora" });
      expect(recipe.space.delayFeedback).toBeLessThanOrEqual(0.5);
    }
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
