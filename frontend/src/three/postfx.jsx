/* =========================================================================
   Post-processing + image-based lighting.

   - PostEffects: N8AO (screen-space ambient occlusion grounds every prop and
     darkens the shell corners), mipmap Bloom (the emissive seams, candles
     and neon actually cast glare), film grain for the moody families, and a
     vignette — all tuned per family via mood.post.
   - EnvironmentLight: three's built-in RoomEnvironment run through PMREM as
     a subtle scene.environment, so metals and glossy screens pick up real
     reflections instead of reading as flat plastic. Intensity is a per-
     family dial (strong for sci-fi/cyberpunk chrome, faint for horror).
   ========================================================================= */

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { EffectComposer, N8AO, Bloom, Noise, Vignette, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export function EnvironmentLight({ intensity = 0.2 }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new RoomEnvironment();
    const envMap = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = envMap;
    return () => {
      scene.environment = null;
      envMap.dispose();
      pmrem.dispose();
      envScene.dispose?.();
    };
  }, [gl, scene]);

  useEffect(() => {
    scene.environmentIntensity = intensity;
    return () => {
      scene.environmentIntensity = 1;
    };
  }, [scene, intensity]);

  return null;
}

export function PostEffects({ post, reducedMotion }) {
  const effects = [
    <N8AO
      key="ao"
      halfRes
      quality="performance"
      color="black"
      aoRadius={1.8}
      intensity={post.ao}
      distanceFalloff={1}
    />,
    <Bloom
      key="bloom"
      mipmapBlur
      intensity={post.bloom}
      luminanceThreshold={1}
      luminanceSmoothing={0.25}
    />,
  ];
  // Film grain is animated — leave it out under prefers-reduced-motion.
  if (post.grain > 0 && !reducedMotion) {
    effects.push(<Noise key="grain" premultiply opacity={post.grain} />);
  }
  effects.push(<Vignette key="vig" eskil={false} offset={0.24} darkness={post.vignette} />);
  effects.push(<SMAA key="smaa" />);

  return <EffectComposer multisampling={0}>{effects}</EffectComposer>;
}
