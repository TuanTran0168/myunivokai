"use client";

import {
  Bloom,
  BrightnessContrast,
  ChromaticAberration,
  EffectComposer,
  HueSaturation,
  Noise,
  Vignette
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Vector2 } from "three";
import type { ScenePostFXConfig } from "@/lib/types";

const DEFAULT_BLOOM_INTENSITY = 0.8;
// Selective bloom by luminance: with the composer's HDR (half-float) buffer,
// only deliberate emitters cross this line — the sun's >1 surface tint, the
// star shaders' hot cores, additive pile-ups — while lit planets stay below
// it and no longer leak muddy glow.
const BLOOM_LUMINANCE_THRESHOLD = 0.85;
const BLOOM_LUMINANCE_SMOOTHING = 0.2;
// Pinned explicitly (the library default is also 8 on WebGL2) so a dependency
// update can never silently drop edge anti-aliasing.
const COMPOSER_MULTISAMPLING = 8;

// Cinematic finish: gentle edge darkening, film grain blended soft-light, and
// a sub-pixel radial chromatic fringe. All of these merge into the composer's
// single fullscreen pass, so they are effectively free.
const VIGNETTE_OFFSET = 0.28;
const VIGNETTE_DARKNESS = 0.55;
const FILM_GRAIN_OPACITY = 0.06;
const CHROMATIC_ABERRATION_OFFSET = new Vector2(0.0005, 0.001);
const CHROMATIC_ABERRATION_MODULATION_OFFSET = 0.15;

/**
 * Per-world-style color grade. One entry per theme so switching the style
 * changes the whole frame's character (not just object tints) — the "art
 * direction in a box" knob. Values are deliberately subtle; the identity of
 * each theme should read as a mood, not a filter.
 */
type SceneGrade = {
  hueRadians: number;
  saturation: number;
  brightness: number;
  contrast: number;
};

const DEFAULT_SCENE_GRADE: SceneGrade = { hueRadians: 0, saturation: 0.05, brightness: 0, contrast: 0.05 };

const THEME_SCENE_GRADES: Record<string, SceneGrade> = {
  "cosmic-galaxy": { hueRadians: 0, saturation: 0.06, brightness: 0, contrast: 0.06 },
  nebula: { hueRadians: 0, saturation: 0.12, brightness: 0.01, contrast: 0.05 },
  crystal: { hueRadians: 0, saturation: -0.04, brightness: 0.02, contrast: 0.09 },
  aurora: { hueRadians: 0, saturation: 0.09, brightness: 0, contrast: 0.06 },
  "cyber-orbit": { hueRadians: 0, saturation: 0.14, brightness: 0, contrast: 0.1 }
};

type PostEffectsProps = {
  postFX?: ScenePostFXConfig;
  theme?: string;
};

export function PostEffects({ postFX, theme }: PostEffectsProps) {
  const bloomIntensity = postFX?.bloomIntensity ?? DEFAULT_BLOOM_INTENSITY;
  const grade = THEME_SCENE_GRADES[theme ?? ""] ?? DEFAULT_SCENE_GRADE;

  return (
    <EffectComposer multisampling={COMPOSER_MULTISAMPLING}>
      <Bloom
        intensity={bloomIntensity}
        luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD}
        luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
        mipmapBlur
      />
      <HueSaturation hue={grade.hueRadians} saturation={grade.saturation} />
      <BrightnessContrast brightness={grade.brightness} contrast={grade.contrast} />
      <ChromaticAberration
        offset={CHROMATIC_ABERRATION_OFFSET}
        radialModulation
        modulationOffset={CHROMATIC_ABERRATION_MODULATION_OFFSET}
      />
      <Vignette eskil={false} offset={VIGNETTE_OFFSET} darkness={VIGNETTE_DARKNESS} />
      <Noise premultiply opacity={FILM_GRAIN_OPACITY} blendFunction={BlendFunction.SOFT_LIGHT} />
    </EffectComposer>
  );
}
