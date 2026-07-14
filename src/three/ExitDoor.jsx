/* =========================================================================
   The exit — a monumental double door recessed into the -z wall. Every room
   has one: it's what the puzzles are between you and.

   This component owns the whole -z wall (the RoomShell leaves it out): wall
   segments around a real opening, a recessed corridor behind it, the two
   leaves, and a row of seal lamps across the lintel — one per puzzle, each
   lighting as its puzzle is solved. At full progress the leaves slide into
   the walls and light floods the room while the completion screen holds off.

   If the generator produced a door object bound to a puzzle, that puzzle
   lives here and the door is clickable like any prop.
   ========================================================================= */

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { ROOM, EXIT } from "./layoutRoom";
import { propStatePalette } from "./familyPresets";
import { surfaceMaterialProps } from "./surfaces";
import { SceneContext } from "./SceneContext";

const { halfD, height } = ROOM;
const W = EXIT.width;
const H = EXIT.height;
const D = EXIT.recess;
const SEG_W = (ROOM.width - W) / 2; // wall segment on each side of the opening
const LEAF_W = W / 2 - 0.02;

const STATE_LABEL = {
  locked: "Locked",
  active: "Inspect",
  solved: "Solved ✓",
};

export default function ExitDoor({
  prop,
  state,
  tokens,
  shell,
  surfaces,
  progress,
  solvedCount,
  total,
  enabled,
  onSelect,
}) {
  const { reducedMotion } = useContext(SceneContext);
  const [hovered, setHovered] = useState(false);

  const leftLeaf = useRef();
  const rightLeaf = useRef();
  const leafMats = useRef([]);
  const seamMats = useRef([]);
  const lampMats = useRef([]);
  const gateMat = useRef();
  const floodRef = useRef();
  const openT = useRef(0);

  const clickable = Boolean(enabled && prop && prop.interactive);
  const open = progress >= 1;

  // A decor exit door still tells the story: sealed until everything is
  // solved, then it's the way out.
  const effState = prop?.interactive ? state : open ? "solved" : "locked";

  const palette = useMemo(() => propStatePalette(tokens, effState), [tokens, effState]);
  const accent = useMemo(() => new THREE.Color(tokens.accent), [tokens]);
  const floodColor = useMemo(
    () => new THREE.Color(tokens.accent).lerp(new THREE.Color("#ffffff"), 0.45),
    [tokens]
  );
  const lampDark = useMemo(() => new THREE.Color("#0a0a0a"), []);

  const wallColor = shell.wall;
  const trimColor = shell.trim;
  const recessColor = useMemo(
    () => shell.wall.clone().multiplyScalar(0.55),
    [shell]
  );

  // Lamp positions spread across the lintel.
  const lamps = useMemo(() => {
    const n = Math.max(total, 1);
    const spread = Math.min(W - 1.0, n * 0.55);
    return Array.from({ length: n }, (_, i) => ({
      x: n === 1 ? 0 : -spread / 2 + (spread / (n - 1)) * i,
    }));
  }, [total]);

  useFrame((frame, dt) => {
    const t = frame.clock.elapsedTime;
    const k = 1 - Math.exp(-6 * Math.min(dt, 0.1));

    // Leaves slide into the wall segments once the room is beaten.
    const target = open ? 1 : 0;
    openT.current = reducedMotion
      ? target
      : THREE.MathUtils.damp(openT.current, target, 1.4, dt);
    const slide = openT.current * (LEAF_W + 0.12);
    if (leftLeaf.current) leftLeaf.current.position.x = -LEAF_W / 2 - 0.01 - slide;
    if (rightLeaf.current) rightLeaf.current.position.x = LEAF_W / 2 + 0.01 + slide;

    const hoverBoost = hovered && clickable ? 0.9 : 0;
    const breathe =
      reducedMotion || effState !== "active" ? 1 : 1 + 0.16 * Math.sin(t * 1.7);

    for (const m of leafMats.current) {
      if (!m) continue;
      m.color.lerp(palette.panel, k);
    }
    for (const m of seamMats.current) {
      if (!m) continue;
      m.emissive.lerp(palette.glow, k);
      m.emissiveIntensity = THREE.MathUtils.lerp(
        m.emissiveIntensity,
        (palette.glowIntensity * 0.8 + hoverBoost) * breathe + openT.current * 2,
        k
      );
    }
    lampMats.current.forEach((m, i) => {
      if (!m) return;
      const lit = i < solvedCount || open;
      // The next seal in line stirs faintly — the door is waiting on it.
      const anticipating = !lit && i === solvedCount && !reducedMotion;
      m.emissive.copy(lit || anticipating ? accent : lampDark);
      m.emissiveIntensity = THREE.MathUtils.lerp(
        m.emissiveIntensity,
        lit
          ? 2.4 + hoverBoost * 0.5
          : anticipating
            ? 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t * 2.2))
            : 0.05,
        k
      );
    });
    if (gateMat.current) {
      gateMat.current.emissiveIntensity = THREE.MathUtils.lerp(
        gateMat.current.emissiveIntensity,
        0.55 + openT.current * 3.2,
        k
      );
    }
    if (floodRef.current) {
      floodRef.current.intensity = openT.current * 30;
    }
  });

  const handleOver = (e) => {
    if (!clickable) return;
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = "pointer";
  };
  const handleOut = () => {
    setHovered(false);
    document.body.style.cursor = "";
  };
  useEffect(() => () => {
    if (hovered) document.body.style.cursor = "";
  }, [hovered]);
  const handleClick = (e) => {
    if (!clickable) return;
    e.stopPropagation();
    onSelect(prop);
  };

  const leafMat = (i) => (
    <meshStandardMaterial
      ref={(el) => (leafMats.current[i] = el)}
      color="#181818"
      roughness={0.7}
      metalness={0.25}
    />
  );

  // Same procedural wall surface as the RoomShell, repeats matched to each
  // segment's world size so the material scale is continuous around the room.
  const segMats = useMemo(
    () =>
      surfaces && {
        side: surfaceMaterialProps(surfaces.wall, SEG_W, height),
        top: surfaceMaterialProps(surfaces.wall, W, height - H),
      },
    [surfaces]
  );

  return (
    <group>
      {/* ---- the -z wall around the opening ---- */}
      <mesh position={[-(W / 2 + SEG_W / 2), height / 2, -halfD]} receiveShadow>
        <planeGeometry args={[SEG_W, height]} />
        <meshStandardMaterial color={wallColor} {...segMats?.side} />
      </mesh>
      <mesh position={[W / 2 + SEG_W / 2, height / 2, -halfD]} receiveShadow>
        <planeGeometry args={[SEG_W, height]} />
        <meshStandardMaterial color={wallColor} {...segMats?.side} />
      </mesh>
      <mesh position={[0, H + (height - H) / 2, -halfD]} receiveShadow>
        <planeGeometry args={[W, height - H]} />
        <meshStandardMaterial color={wallColor} {...segMats?.top} />
      </mesh>
      {/* baseboards on the segments */}
      {[-(W / 2 + SEG_W / 2), W / 2 + SEG_W / 2].map((x) => (
        <mesh key={x} position={[x, 0.09, -halfD + 0.04]}>
          <boxGeometry args={[SEG_W, 0.18, 0.08]} />
          <meshStandardMaterial color={trimColor} roughness={0.8} />
        </mesh>
      ))}

      {/* ---- the recess behind the opening ---- */}
      <mesh position={[-W / 2, H / 2, -halfD - D / 2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[D, H]} />
        <meshStandardMaterial color={recessColor} roughness={0.95} />
      </mesh>
      <mesh position={[W / 2, H / 2, -halfD - D / 2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[D, H]} />
        <meshStandardMaterial color={recessColor} roughness={0.95} />
      </mesh>
      <mesh position={[0, H, -halfD - D / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color={recessColor} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.001, -halfD - D / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color={recessColor} roughness={0.95} />
      </mesh>
      {/* the light gate at the back of the recess */}
      <mesh position={[0, H / 2, -halfD - D + 0.02]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial
          ref={gateMat}
          color="#060606"
          emissive={floodColor}
          emissiveIntensity={0.55}
          roughness={0.6}
        />
      </mesh>
      <pointLight
        ref={floodRef}
        position={[0, 2.1, -halfD - 0.3]}
        intensity={0}
        distance={13}
        decay={1.5}
        color={floodColor}
      />

      {/* ---- clickable door assembly ---- */}
      <group onClick={handleClick} onPointerOver={handleOver} onPointerOut={handleOut}>
        {/* frame: pilasters + lintel + threshold plate */}
        <mesh castShadow position={[-(W / 2 + 0.16), (H + 0.25) / 2, -halfD + 0.13]}>
          <boxGeometry args={[0.32, H + 0.25, 0.3]} />
          <meshStandardMaterial color={trimColor} roughness={0.75} metalness={0.15} />
        </mesh>
        <mesh castShadow position={[W / 2 + 0.16, (H + 0.25) / 2, -halfD + 0.13]}>
          <boxGeometry args={[0.32, H + 0.25, 0.3]} />
          <meshStandardMaterial color={trimColor} roughness={0.75} metalness={0.15} />
        </mesh>
        <mesh castShadow position={[0, H + 0.28, -halfD + 0.13]}>
          <boxGeometry args={[W + 0.96, 0.42, 0.34]} />
          <meshStandardMaterial color={trimColor} roughness={0.75} metalness={0.15} />
        </mesh>
        <mesh position={[0, 0.035, -halfD + 0.22]}>
          <boxGeometry args={[W + 0.5, 0.07, 0.55]} />
          <meshStandardMaterial color={trimColor} roughness={0.85} />
        </mesh>

        {/* seal lamps across the lintel — one per puzzle */}
        {lamps.map((lamp, i) => (
          <mesh key={i} position={[lamp.x, H + 0.28, -halfD + 0.31]}>
            <boxGeometry args={[0.18, 0.18, 0.05]} />
            <meshStandardMaterial
              ref={(el) => (lampMats.current[i] = el)}
              color="#0d0d0d"
              emissive="#0a0a0a"
              emissiveIntensity={0.05}
              roughness={0.4}
            />
          </mesh>
        ))}

        {/* the two leaves, inside the recess */}
        <group ref={leftLeaf} position={[-LEAF_W / 2 - 0.01, 0, 0]}>
          <mesh castShadow position={[0, H / 2 - 0.02, -halfD - 0.32]}>
            <boxGeometry args={[LEAF_W, H - 0.06, 0.14]} />
            {leafMat(0)}
          </mesh>
          {/* inner-edge seam strip */}
          <mesh position={[LEAF_W / 2 - 0.03, H / 2 - 0.02, -halfD - 0.24]}>
            <boxGeometry args={[0.05, H - 0.35, 0.03]} />
            <meshStandardMaterial
              ref={(el) => (seamMats.current[0] = el)}
              color="#080808"
              emissive="#000000"
              emissiveIntensity={0}
              roughness={0.4}
            />
          </mesh>
          {/* leaf panel inset */}
          <mesh position={[-0.12, H / 2 + 0.35, -halfD - 0.24]}>
            <boxGeometry args={[LEAF_W - 0.55, H - 1.6, 0.02]} />
            {leafMat(1)}
          </mesh>
        </group>
        <group ref={rightLeaf} position={[LEAF_W / 2 + 0.01, 0, 0]}>
          <mesh castShadow position={[0, H / 2 - 0.02, -halfD - 0.32]}>
            <boxGeometry args={[LEAF_W, H - 0.06, 0.14]} />
            {leafMat(2)}
          </mesh>
          <mesh position={[-LEAF_W / 2 + 0.03, H / 2 - 0.02, -halfD - 0.24]}>
            <boxGeometry args={[0.05, H - 0.35, 0.03]} />
            <meshStandardMaterial
              ref={(el) => (seamMats.current[1] = el)}
              color="#080808"
              emissive="#000000"
              emissiveIntensity={0}
              roughness={0.4}
            />
          </mesh>
          <mesh position={[0.12, H / 2 + 0.35, -halfD - 0.24]}>
            <boxGeometry args={[LEAF_W - 0.55, H - 1.6, 0.02]} />
            {leafMat(3)}
          </mesh>
        </group>
      </group>

      {/* light spilling through the open doorway */}
      {!reducedMotion && open && (
        <>
          <mesh position={[0, H / 2 - 0.4, -halfD + 2.4]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[2.3, 4.9, 24, 1, true]} />
            <meshBasicMaterial
              color={floodColor}
              transparent
              opacity={0.1}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <Sparkles
            count={40}
            scale={[3.4, 3.4, 2.6]}
            position={[0, 1.9, -halfD + 1.2]}
            size={3.4}
            speed={0.8}
            opacity={0.75}
            color={tokens.accent}
          />
        </>
      )}

      {hovered && clickable && (
        <Html position={[0, H + 0.85, -halfD + 0.4]} center distanceFactor={7} zIndexRange={[20, 0]}>
          <div className={`obj-label obj-label--${effState}`}>
            <span className="obj-label-name">{prop.label}</span>
            <span className="obj-label-state">{STATE_LABEL[effState] || effState}</span>
          </div>
        </Html>
      )}
    </group>
  );
}
