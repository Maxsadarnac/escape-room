/* =========================================================================
   The 3D room: shell, per-family decor, mood-reactive lighting, camera rig
   (cinematic intro -> bounded OrbitControls), and the interactive props.

   Everything is primitive geometry; all colors flow from the families.css
   tokens via familyPresets. Lighting lerps with solve progress so the room
   itself registers the player's advance.
   ========================================================================= */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { ROOM } from "./layoutRoom";
import { buildMood } from "./familyPresets";
import { InteractiveProp } from "./archetypes";
import { SceneContext } from "./SceneContext";

const { halfW, halfD, width, depth, height } = ROOM;

/* ---- Camera rig ---------------------------------------------------------
   Orbit constraints keep the camera inside the shell without per-frame
   clamping: max orbit radius 5.4 < halfD - 0.5, polar range keeps
   y within [~1.4, ~4.9] for a 5m ceiling.                                  */

const ORBIT_TARGET = new THREE.Vector3(0, 1.1, 0);
const INTRO_END = [3.4, 2.05, 3.4];
const INTRO_DURATION = 4.8;

const smootherstep = (t) => t * t * t * (t * (6 * t - 15) + 10);

function CameraRig({ phase, onIntroDone, focusProp, reducedMotion }) {
  const camera = useThree((s) => s.camera);
  const controlsRef = useRef();
  const tRef = useRef(0);
  const doneRef = useRef(false);
  // Focus glide state: where to return to, and the damped look-at point.
  const focusRef = useRef({ saved: null, look: new THREE.Vector3().copy(ORBIT_TARGET) });
  const [returning, setReturning] = useState(false);
  const curve = useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(-5.2, 3.9, 4.5),
          new THREE.Vector3(-2.2, 3.05, 5.2),
          new THREE.Vector3(1.8, 2.55, 4.8),
          new THREE.Vector3(...INTRO_END),
        ],
        false,
        "centripetal"
      ),
    []
  );

  // Entering "live" early (skip button / reduced motion): jump to the
  // settled shot so OrbitControls takes over from a valid pose.
  useEffect(() => {
    if (phase === "live" && tRef.current < 1) {
      tRef.current = 1;
      camera.position.set(...INTRO_END);
      camera.lookAt(ORBIT_TARGET);
    }
  }, [phase, camera]);

  useFrame((_, dt) => {
    if (phase === "waiting") {
      camera.position.copy(curve.getPoint(0));
      camera.lookAt(ORBIT_TARGET);
      return;
    }
    if (phase === "intro" && tRef.current < 1) {
      tRef.current = Math.min(1, tRef.current + Math.min(dt, 0.1) / INTRO_DURATION);
      camera.position.copy(curve.getPoint(smootherstep(tRef.current)));
      camera.lookAt(ORBIT_TARGET);
      if (tRef.current >= 1 && !doneRef.current) {
        doneRef.current = true;
        onIntroDone();
      }
      return;
    }
    if (phase !== "live" || reducedMotion) return;

    // Focus glide: dolly toward a clicked object, hold while its puzzle is
    // open, glide home when it closes, then hand back to OrbitControls.
    const f = focusRef.current;
    const k = 1 - Math.exp(-3.4 * Math.min(dt, 0.1));
    if (focusProp) {
      if (!f.saved && controlsRef.current) {
        f.saved = {
          pos: camera.position.clone(),
          target: controlsRef.current.target.clone(),
        };
        f.look.copy(f.saved.target);
        if (returning) setReturning(false);
      }
      const objCenter = new THREE.Vector3(
        focusProp.position[0],
        focusProp.position[1] + (focusProp.wallMounted ? 0 : 1.0),
        focusProp.position[2]
      );
      // Stand 2.7m off the prop's front (its front already faces inward).
      const front = new THREE.Vector3(
        Math.sin(focusProp.rotationY), 0, Math.cos(focusProp.rotationY)
      );
      const goal = objCenter.clone().addScaledVector(front, 2.7);
      goal.y = THREE.MathUtils.clamp(objCenter.y + 0.9, 1.7, 3.2);
      camera.position.lerp(goal, k);
      f.look.lerp(objCenter, k);
      camera.lookAt(f.look);
    } else if (f.saved) {
      if (!returning) setReturning(true);
      camera.position.lerp(f.saved.pos, k);
      f.look.lerp(f.saved.target, k);
      camera.lookAt(f.look);
      if (camera.position.distanceTo(f.saved.pos) < 0.06 && controlsRef.current) {
        controlsRef.current.target.copy(f.saved.target);
        controlsRef.current.update();
        f.saved = null;
        setReturning(false);
      }
    }
  });

  const gliding = Boolean(focusProp) || returning;

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={phase === "live" && (reducedMotion || !gliding)}
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      target={[ORBIT_TARGET.x, ORBIT_TARGET.y, ORBIT_TARGET.z]}
      minDistance={2.4}
      maxDistance={5.4}
      minPolarAngle={0.8}
      maxPolarAngle={1.45}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
    />
  );
}

/* ---- Mood lighting ------------------------------------------------------ */

// Layered sines -> organic 0..1 flicker signal.
function flickerNoise(t) {
  const n =
    0.62 +
    0.28 * Math.sin(t * 11.3) * Math.sin(t * 5.7 + 1.7) +
    0.1 * Math.sin(t * 29.1 + 0.4);
  return THREE.MathUtils.clamp(n, 0, 1);
}

// three uses physical light units: point lights need far more energy than
// the old unitless scale, and the family albedos are deliberately dark.
const POINT_SCALE = 14;
const KEY_SCALE = 2.0;
const AMBIENT_SCALE = 2.2;

function MoodLights({ mood, progress, reducedMotion }) {
  const ambientRef = useRef();
  const keyRef = useRef();
  const accentRefs = useRef([]);
  const shown = useRef({ p: 0 }); // displayed progress eases toward target

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const s = shown.current;
    // Mood shifts settle over ~2s per solve — environmental feedback, not a flash.
    s.p = THREE.MathUtils.damp(s.p, progress, 1.6, dt);
    const p = s.p;

    const calm = reducedMotion ? 0 : 1;
    const flick = 1 - mood.flicker * calm * (1 - p * 0.65) * (1 - flickerNoise(t));

    if (ambientRef.current) {
      ambientRef.current.intensity =
        THREE.MathUtils.lerp(mood.ambient.start, mood.ambient.end, p) * AMBIENT_SCALE;
      ambientRef.current.color.copy(mood.ambient.color);
    }
    if (keyRef.current) {
      keyRef.current.intensity =
        THREE.MathUtils.lerp(mood.key.start, mood.key.end, p) * KEY_SCALE * flick;
      keyRef.current.color.lerpColors(mood.key.colorStart, mood.key.colorEnd, p);
    }
    mood.accents.forEach((a, i) => {
      const light = accentRefs.current[i];
      if (!light) return;
      const pulse = a.pulse
        ? 1 + a.pulse * calm * (1 - p) * Math.sin(t * 2.6 + i * 2.1)
        : 1;
      light.intensity =
        THREE.MathUtils.lerp(a.start, a.end, p) * POINT_SCALE * pulse * (i === 0 ? flick : 1);
      light.color.copy(a.color);
    });
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={mood.ambient.start} />
      <directionalLight
        ref={keyRef}
        position={mood.key.position}
        intensity={mood.key.start}
        castShadow={mood.key.shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-bias={-0.0004}
      />
      {mood.accents.map((a, i) => (
        <pointLight
          key={i}
          ref={(el) => (accentRefs.current[i] = el)}
          position={a.position}
          intensity={a.start}
          distance={a.distance}
          decay={1.6}
        />
      ))}
    </>
  );
}

/* ---- Room shell ---------------------------------------------------------- */

function RoomShell({ mood }) {
  const { floor, wall, ceiling, trim } = mood.shell;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={floor} roughness={0.94} />
      </mesh>
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={ceiling} roughness={1} />
      </mesh>
      {/* walls, facing inward */}
      <mesh position={[0, height / 2, -halfD]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={wall} roughness={0.92} />
      </mesh>
      <mesh position={[0, height / 2, halfD]} rotation={[0, Math.PI, 0]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={wall} roughness={0.92} />
      </mesh>
      <mesh position={[-halfW, height / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={wall} roughness={0.92} />
      </mesh>
      <mesh position={[halfW, height / 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={wall} roughness={0.92} />
      </mesh>
      {/* baseboards */}
      {[
        { pos: [0, 0.09, -halfD + 0.04], size: [width, 0.18, 0.08] },
        { pos: [0, 0.09, halfD - 0.04], size: [width, 0.18, 0.08] },
        { pos: [-halfW + 0.04, 0.09, 0], size: [0.08, 0.18, depth] },
        { pos: [halfW - 0.04, 0.09, 0], size: [0.08, 0.18, depth] },
      ].map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color={trim} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/* ---- Per-family decor ---------------------------------------------------
   Non-interactive set dressing that gives each family its own architecture.
   Static primitives; the mood lights carry the progression.                */

function GlowMat({ color, intensity = 1.2 }) {
  return (
    <meshStandardMaterial
      color="#080808"
      emissive={color}
      emissiveIntensity={intensity}
      roughness={0.5}
    />
  );
}

function DarkMat({ color, roughness = 0.9 }) {
  return <meshStandardMaterial color={color} roughness={roughness} />;
}

function SciFiDecor({ tokens }) {
  const strip = tokens.primary;
  return (
    <group>
      {/* ceiling light panel */}
      <mesh position={[0, height - 0.04, 0]}>
        <boxGeometry args={[4.6, 0.07, 1.4]} />
        <GlowMat color={strip} intensity={1.1} />
      </mesh>
      {/* perimeter light strips */}
      {[
        { pos: [0, 2.7, -halfD + 0.03], size: [width - 0.4, 0.05, 0.05] },
        { pos: [0, 2.7, halfD - 0.03], size: [width - 0.4, 0.05, 0.05] },
        { pos: [-halfW + 0.03, 2.7, 0], size: [0.05, 0.05, depth - 0.4] },
        { pos: [halfW - 0.03, 2.7, 0], size: [0.05, 0.05, depth - 0.4] },
      ].map((s, i) => (
        <mesh key={i} position={s.pos}>
          <boxGeometry args={s.size} />
          <GlowMat color={strip} intensity={0.9} />
        </mesh>
      ))}
      {/* floor locator ring */}
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.05, 1.14, 48]} />
        <meshBasicMaterial color={strip} transparent opacity={0.22} depthWrite={false} />
      </mesh>
    </group>
  );
}

function FantasyDecor({ tokens }) {
  const gold = tokens.primary;
  const braziers = [
    [-5.5, 0, -4.3],
    [5.5, 0, -4.3],
  ];
  return (
    <group>
      {braziers.map((pos, i) => (
        <group key={i} position={pos}>
          <mesh castShadow position={[0, 0.55, 0]}>
            <cylinderGeometry args={[0.07, 0.12, 1.1, 10]} />
            <DarkMat color={tokens.border} />
          </mesh>
          <mesh castShadow position={[0, 1.16, 0]}>
            <cylinderGeometry args={[0.3, 0.14, 0.24, 12]} />
            <DarkMat color={tokens.border} />
          </mesh>
          <mesh position={[0, 1.34, 0]}>
            <sphereGeometry args={[0.13, 12, 10]} />
            <GlowMat color={gold} intensity={2.4} />
          </mesh>
        </group>
      ))}
      {/* gilt picture rail */}
      {[
        { pos: [0, 3.4, -halfD + 0.03], size: [width - 0.6, 0.07, 0.06] },
        { pos: [0, 3.4, halfD - 0.03], size: [width - 0.6, 0.07, 0.06] },
        { pos: [-halfW + 0.03, 3.4, 0], size: [0.06, 0.07, depth - 0.6] },
        { pos: [halfW - 0.03, 3.4, 0], size: [0.06, 0.07, depth - 0.6] },
      ].map((s, i) => (
        <mesh key={i} position={s.pos}>
          <boxGeometry args={s.size} />
          <GlowMat color={gold} intensity={0.35} />
        </mesh>
      ))}
      {/* round rug under the orbit center */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.1, 40]} />
        <meshStandardMaterial color={new THREE.Color(gold).multiplyScalar(0.22)} roughness={1} />
      </mesh>
    </group>
  );
}

function HorrorDecor({ tokens }) {
  const beam = new THREE.Color(tokens.border).multiplyScalar(0.5);
  const candleGroups = [
    [-6.6, 0, -4.8],
    [6.6, 0, 4.6],
    [-6.4, 0, 4.7],
  ];
  return (
    <group>
      {/* ceiling beams */}
      {[-4, 0, 4].map((x) => (
        <mesh key={x} position={[x, height - 0.16, 0]}>
          <boxGeometry args={[0.34, 0.3, depth]} />
          <DarkMat color={beam} />
        </mesh>
      ))}
      {/* guttering candle clusters */}
      {candleGroups.map((pos, gi) => (
        <group key={gi} position={pos}>
          {[
            [0, 0.17, 0, 0.34],
            [0.16, 0.12, 0.06, 0.24],
            [-0.13, 0.09, -0.08, 0.18],
          ].map(([x, y, z, h], ci) => (
            <group key={ci}>
              <mesh position={[x, y, z]}>
                <cylinderGeometry args={[0.035, 0.045, h, 8]} />
                <meshStandardMaterial color="#c9bda6" roughness={0.95} />
              </mesh>
              <mesh position={[x, y + h / 2 + 0.035, z]}>
                <sphereGeometry args={[0.028, 8, 6]} />
                <GlowMat color="#e8a04c" intensity={2.2} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

function NoirDecor({ tokens }) {
  return (
    <group>
      {/* venetian window on the key-light wall */}
      <group position={[-halfW + 0.05, 3.0, -2]} rotation={[0, Math.PI / 2, 0]}>
        <mesh>
          <boxGeometry args={[2.7, 1.8, 0.06]} />
          <GlowMat color="#f2ead6" intensity={1.5} />
        </mesh>
        {[-0.6, -0.2, 0.2, 0.6].map((y) => (
          <mesh key={y} position={[0, y, 0.05]}>
            <boxGeometry args={[2.7, 0.13, 0.03]} />
            <DarkMat color={new THREE.Color(tokens.surface).multiplyScalar(0.5)} />
          </mesh>
        ))}
        <mesh position={[0, 0, 0.05]}>
          <boxGeometry args={[0.1, 1.8, 0.04]} />
          <DarkMat color={new THREE.Color(tokens.surface).multiplyScalar(0.5)} />
        </mesh>
      </group>
      {/* bare hanging bulb */}
      <group position={[0.8, 0, 0.6]}>
        <mesh position={[0, height - 0.55, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 1.1, 6]} />
          <DarkMat color="#111111" />
        </mesh>
        <mesh position={[0, height - 1.14, 0]}>
          <sphereGeometry args={[0.09, 12, 10]} />
          <GlowMat color="#f2e6c8" intensity={2.1} />
        </mesh>
      </group>
    </group>
  );
}

function NatureDecor({ tokens }) {
  const green = new THREE.Color(tokens.primary).multiplyScalar(0.45);
  const vines = [
    [-7.7, 5.6, -3, 1.9],
    [-7.6, 5.6, 2.5, 2.6],
    [7.7, 5.6, -1.5, 2.2],
    [7.6, 5.6, 4, 1.7],
    [-3, 5.6, -5.7, 2.4],
    [4, 5.6, 5.7, 2.0],
  ];
  return (
    <group>
      {vines.map(([x, y, z, len], i) => (
        <mesh key={i} position={[x, y - len / 2 - 0.6, z]}>
          <cylinderGeometry args={[0.025, 0.045, len, 6]} />
          <DarkMat color={green} />
        </mesh>
      ))}
      {/* canopy masses in the ceiling corners */}
      {[
        [-6.8, 4.7, -5],
        [6.8, 4.7, -5],
        [-6.8, 4.7, 5],
        [6.8, 4.7, 5],
      ].map((pos, i) => (
        <mesh key={i} position={pos} scale={[1.6, 0.75, 1.6]}>
          <icosahedronGeometry args={[0.85, 0]} />
          <DarkMat color={green} />
        </mesh>
      ))}
      {/* moss patches */}
      {[
        [-3.4, 0.013, 2.6, 1.2],
        [2.8, 0.013, -3.1, 0.9],
        [4.6, 0.013, 2.2, 0.7],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[r, 24]} />
          <meshStandardMaterial color={green} roughness={1} transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function CyberpunkDecor({ tokens }) {
  const magenta = tokens.primary;
  const cyan = tokens.accent;
  const frame = (w, h) => [
    { pos: [0, h / 2, 0], size: [w, 0.06, 0.06] },
    { pos: [0, -h / 2, 0], size: [w, 0.06, 0.06] },
    { pos: [-w / 2, 0, 0], size: [0.06, h, 0.06] },
    { pos: [w / 2, 0, 0], size: [0.06, h, 0.06] },
  ];
  return (
    <group>
      {/* neon sign frames */}
      <group position={[0, 3.1, -halfD + 0.08]}>
        {frame(3.2, 1.4).map((s, i) => (
          <mesh key={i} position={s.pos}>
            <boxGeometry args={s.size} />
            <GlowMat color={magenta} intensity={2.2} />
          </mesh>
        ))}
      </group>
      <group position={[halfW - 0.08, 3.0, 1.5]} rotation={[0, -Math.PI / 2, 0]}>
        {frame(2.4, 1.1).map((s, i) => (
          <mesh key={i} position={s.pos}>
            <boxGeometry args={s.size} />
            <GlowMat color={cyan} intensity={2.0} />
          </mesh>
        ))}
      </group>
      {/* floor circuit strips */}
      <mesh position={[0, 0.012, -1.2]}>
        <boxGeometry args={[width - 0.6, 0.02, 0.07]} />
        <GlowMat color={cyan} intensity={0.8} />
      </mesh>
      <mesh position={[2.4, 0.012, 0]}>
        <boxGeometry args={[0.07, 0.02, depth - 0.6]} />
        <GlowMat color={magenta} intensity={0.7} />
      </mesh>
    </group>
  );
}

const DECOR = {
  "sci-fi": SciFiDecor,
  fantasy: FantasyDecor,
  "horror-gothic": HorrorDecor,
  "noir-mystery": NoirDecor,
  nature: NatureDecor,
  cyberpunk: CyberpunkDecor,
};

/* ---- Scene root ---------------------------------------------------------- */

export default function Room3D({
  room,
  layout,
  family,
  tokens,
  solved,
  phase,
  onIntroDone,
  onSelectObject,
  focusProp,
  reducedMotion,
}) {
  const paletteHints = useMemo(() => {
    const raw = room?.scene?.palette;
    if (!Array.isArray(raw)) return [];
    return raw.filter((c) => typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()));
  }, [room]);

  const mood = useMemo(
    () => buildMood(family, tokens, { moodText: room?.scene?.mood, paletteHints }),
    [family, tokens, room, paletteHints]
  );
  const progress = room.puzzles.length > 0 ? solved.size / room.puzzles.length : 0;

  const requiresById = useMemo(
    () => new Map(room.puzzles.map((p) => [p.id, Array.isArray(p.requires) ? p.requires : []])),
    [room]
  );

  const sceneCtx = useMemo(
    () => ({ reducedMotion, paletteHints }),
    [reducedMotion, paletteHints]
  );

  const stateFor = (prop) => {
    if (!prop.interactive) return "decor";
    if (solved.has(prop.puzzleId)) return "solved";
    const reqs = requiresById.get(prop.puzzleId) || [];
    return reqs.some((r) => !solved.has(r)) ? "locked" : "active";
  };

  const Decor = DECOR[family] || SciFiDecor;

  return (
    <Canvas
      className="room3d-canvas"
      shadows
      dpr={[1, 1.75]}
      camera={{ fov: 55, near: 0.1, far: 60, position: INTRO_END }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <SceneContext.Provider value={sceneCtx}>
        <color attach="background" args={[mood.fog.color]} />
        <fog attach="fog" args={[mood.fog.color, mood.fog.near, mood.fog.far]} />

        <MoodLights mood={mood} progress={progress} reducedMotion={reducedMotion} />
        <RoomShell mood={mood} />
        <Decor tokens={tokens} />

        {!reducedMotion && (
          <>
            <Sparkles
              count={mood.dust.count}
              scale={[width - 3, 3.6, depth - 3]}
              position={[0, 2.2, 0]}
              size={mood.dust.size}
              speed={mood.dust.speed}
              opacity={mood.dust.opacity}
              color={mood.dust.color}
            />
            {(mood.extra || []).map((v, i) => (
              <Sparkles
                key={i}
                count={v.count}
                scale={v.scale}
                position={v.position}
                size={v.size}
                speed={v.speed}
                opacity={v.opacity}
                color={v.color}
              />
            ))}
          </>
        )}

        {layout.map((prop) => (
          <InteractiveProp
            key={prop.id}
            prop={prop}
            state={stateFor(prop)}
            tokens={tokens}
            family={family}
            enabled={phase === "live"}
            onSelect={onSelectObject}
          />
        ))}

        {/* finale: the room celebrates while the completion screen holds off */}
        {progress >= 1 && !reducedMotion && (
          <Sparkles
            count={90}
            scale={[7, 3.4, 6]}
            position={[0, 2.1, 0]}
            size={4.2}
            speed={1.1}
            opacity={0.8}
            color={tokens.accent}
          />
        )}

        <CameraRig
          phase={phase}
          onIntroDone={onIntroDone}
          focusProp={focusProp}
          reducedMotion={reducedMotion}
        />
      </SceneContext.Provider>
    </Canvas>
  );
}
