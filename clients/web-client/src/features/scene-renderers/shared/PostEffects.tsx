"use client";

import { Bloom, EffectComposer } from "@react-three/postprocessing";
import type { ScenePostFXConfig } from "@/lib/types";

const DEFAULT_BLOOM_INTENSITY = 0.8;
const BLOOM_LUMINANCE_THRESHOLD = 0.45;
const BLOOM_LUMINANCE_SMOOTHING = 0.2;
// Pinned explicitly (the library default is also 8 on WebGL2) so a dependency
// update can never silently drop edge anti-aliasing.
const COMPOSER_MULTISAMPLING = 8;

type PostEffectsProps = {
  postFX?: ScenePostFXConfig;
};

export function PostEffects({ postFX }: PostEffectsProps) {
  const bloomIntensity = postFX?.bloomIntensity ?? DEFAULT_BLOOM_INTENSITY;

  return (
    <EffectComposer multisampling={COMPOSER_MULTISAMPLING}>
      <Bloom
        intensity={bloomIntensity}
        luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD}
        luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
        mipmapBlur
      />
    </EffectComposer>
  );
}
