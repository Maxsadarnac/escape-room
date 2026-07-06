/* =========================================================================
   Prop archetypes — every interactive object in the room is composed from
   primitive geometry only (boxes, cylinders, spheres, torus, octahedron).

   Materials are tagged with userData.role so the InteractiveProp wrapper
   can drive their colors from the family tokens + puzzle state:
     body     — structural mass
     panel    — secondary surfaces (doors, screens' housings, boards)
     glow     — bright emissive features (screens, seams, crystals)
     glowSoft — dim emissive details (buttons, handles, runes)
   Book spines opt out via role "tinted" (fixed incidental colors).
   ========================================================================= */

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { SceneContext } from "./SceneContext";
import { FAMILY_FINISH, propStatePalette } from "./familyPresets";

/* ---- Material helper ---------------------------------------------------- */

function Mat({ role, roughness = 0.85, metalness = 0.1 }) {
  return (
    <meshStandardMaterial
      userData={{ role }}
      color="#181818"
      emissive="#000000"
      roughness={roughness}
      metalness={metalness}
    />
  );
}

/* ---- Archetype geometry -------------------------------------------------
   All face +z by default; the layout engine rotates them into place.       */

function Console() {
  return (
    <group>
      {/* main chassis */}
      <mesh castShadow position={[0, 0.42, 0]}>
        <boxGeometry args={[1.5, 0.84, 0.72]} />
        <Mat role="body" />
      </mesh>
      {/* side cheeks */}
      <mesh castShadow position={[-0.79, 0.38, 0]}>
        <boxGeometry args={[0.09, 0.76, 0.62]} />
        <Mat role="panel" />
      </mesh>
      <mesh castShadow position={[0.79, 0.38, 0]}>
        <boxGeometry args={[0.09, 0.76, 0.62]} />
        <Mat role="panel" />
      </mesh>
      {/* angled work surface */}
      <mesh castShadow position={[0, 0.93, 0.08]} rotation={[-0.34, 0, 0]}>
        <boxGeometry args={[1.46, 0.1, 0.6]} />
        <Mat role="panel" />
      </mesh>
      {/* screen inset into the work surface */}
      <mesh position={[0, 0.99, 0.1]} rotation={[-0.34, 0, 0]}>
        <boxGeometry args={[1.2, 0.03, 0.36]} />
        <Mat role="glow" roughness={0.4} />
      </mesh>
      {/* button strips */}
      <mesh position={[-0.42, 0.9, 0.31]} rotation={[-0.34, 0, 0]}>
        <boxGeometry args={[0.36, 0.035, 0.09]} />
        <Mat role="glowSoft" roughness={0.5} />
      </mesh>
      <mesh position={[0.42, 0.9, 0.31]} rotation={[-0.34, 0, 0]}>
        <boxGeometry args={[0.36, 0.035, 0.09]} />
        <Mat role="glowSoft" roughness={0.5} />
      </mesh>
      {/* front vent */}
      <mesh position={[0, 0.28, 0.365]}>
        <boxGeometry args={[0.9, 0.16, 0.02]} />
        <Mat role="panel" roughness={0.95} />
      </mesh>
    </group>
  );
}

function WallPanel() {
  return (
    <group>
      {/* frame */}
      <mesh castShadow position={[0, 0, 0.1]}>
        <boxGeometry args={[1.7, 1.15, 0.09]} />
        <Mat role="body" />
      </mesh>
      {/* live surface */}
      <mesh position={[0, 0, 0.16]}>
        <boxGeometry args={[1.48, 0.93, 0.03]} />
        <Mat role="glow" roughness={0.35} />
      </mesh>
      {/* top edge light */}
      <mesh position={[0, 0.62, 0.12]}>
        <boxGeometry args={[1.5, 0.045, 0.05]} />
        <Mat role="glowSoft" />
      </mesh>
      {/* caption plaque */}
      <mesh position={[0, -0.72, 0.1]}>
        <boxGeometry args={[0.72, 0.12, 0.05]} />
        <Mat role="panel" />
      </mesh>
    </group>
  );
}

function Door() {
  return (
    <group>
      {/* jambs + lintel */}
      <mesh castShadow position={[-0.86, 1.45, 0.14]}>
        <boxGeometry args={[0.2, 2.9, 0.26]} />
        <Mat role="body" />
      </mesh>
      <mesh castShadow position={[0.86, 1.45, 0.14]}>
        <boxGeometry args={[0.2, 2.9, 0.26]} />
        <Mat role="body" />
      </mesh>
      <mesh castShadow position={[0, 2.98, 0.14]}>
        <boxGeometry args={[1.92, 0.22, 0.26]} />
        <Mat role="body" />
      </mesh>
      {/* slab */}
      <mesh position={[0, 1.44, 0.1]}>
        <boxGeometry args={[1.52, 2.86, 0.1]} />
        <Mat role="panel" />
      </mesh>
      {/* glowing central seam */}
      <mesh position={[0, 1.44, 0.17]}>
        <boxGeometry args={[0.055, 2.7, 0.02]} />
        <Mat role="glow" roughness={0.4} />
      </mesh>
      {/* keypad */}
      <mesh position={[0.58, 1.35, 0.18]}>
        <boxGeometry args={[0.18, 0.26, 0.06]} />
        <Mat role="body" />
      </mesh>
      <mesh position={[0.58, 1.41, 0.22]}>
        <boxGeometry args={[0.1, 0.08, 0.02]} />
        <Mat role="glowSoft" />
      </mesh>
    </group>
  );
}

function Cabinet() {
  return (
    <group>
      {/* plinth + carcass + cornice */}
      <mesh castShadow position={[0, 0.07, 0]}>
        <boxGeometry args={[1.24, 0.14, 0.66]} />
        <Mat role="panel" />
      </mesh>
      <mesh castShadow position={[0, 1.02, 0]}>
        <boxGeometry args={[1.14, 1.78, 0.58]} />
        <Mat role="body" />
      </mesh>
      <mesh castShadow position={[0, 1.96, 0]}>
        <boxGeometry args={[1.26, 0.12, 0.68]} />
        <Mat role="panel" />
      </mesh>
      {/* double doors, slightly proud */}
      <mesh position={[-0.285, 1.02, 0.31]}>
        <boxGeometry args={[0.52, 1.66, 0.05]} />
        <Mat role="panel" roughness={0.75} />
      </mesh>
      <mesh position={[0.285, 1.02, 0.31]}>
        <boxGeometry args={[0.52, 1.66, 0.05]} />
        <Mat role="panel" roughness={0.75} />
      </mesh>
      {/* handles */}
      <mesh position={[-0.08, 1.05, 0.36]}>
        <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />
        <Mat role="glowSoft" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0.08, 1.05, 0.36]}>
        <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />
        <Mat role="glowSoft" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* lock plate */}
      <mesh position={[0, 1.42, 0.35]}>
        <boxGeometry args={[0.16, 0.16, 0.03]} />
        <Mat role="glow" roughness={0.4} />
      </mesh>
    </group>
  );
}

function Shelf({ seed }) {
  const { paletteHints } = useContext(SceneContext);
  // Deterministic book row layout; spine colors borrow the room's own
  // scene.palette for incidental variety.
  const books = useMemo(() => {
    const tints = paletteHints.length > 0 ? paletteHints : ["#5b5b66", "#46464f", "#6b6355"];
    const rows = [0.32, 1.02, 1.72];
    const out = [];
    rows.forEach((y, r) => {
      let x = -0.62;
      for (let i = 0; i < 5 && x < 0.62; i++) {
        const h = 0.3 + (((seed * 7919 + r * 131 + i * 37) % 13) / 13) * 0.14;
        const w = 0.1 + (((seed * 104729 + r * 17 + i * 71) % 7) / 7) * 0.06;
        out.push({ x: x + w / 2, y: y + h / 2, w, h, tint: tints[(r * 5 + i) % tints.length] });
        x += w + 0.035;
      }
    });
    return out;
  }, [seed, paletteHints]);

  return (
    <group>
      {/* sides, top, bottom, back */}
      <mesh castShadow position={[-0.81, 1.06, 0]}>
        <boxGeometry args={[0.09, 2.12, 0.48]} />
        <Mat role="body" />
      </mesh>
      <mesh castShadow position={[0.81, 1.06, 0]}>
        <boxGeometry args={[0.09, 2.12, 0.48]} />
        <Mat role="body" />
      </mesh>
      <mesh castShadow position={[0, 2.09, 0]}>
        <boxGeometry args={[1.72, 0.09, 0.5]} />
        <Mat role="body" />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[1.72, 0.1, 0.5]} />
        <Mat role="body" />
      </mesh>
      <mesh position={[0, 1.06, -0.21]}>
        <boxGeometry args={[1.62, 2.02, 0.05]} />
        <Mat role="panel" roughness={0.95} />
      </mesh>
      {/* shelf boards */}
      <mesh position={[0, 0.28, 0.02]}>
        <boxGeometry args={[1.55, 0.055, 0.42]} />
        <Mat role="panel" />
      </mesh>
      <mesh position={[0, 0.98, 0.02]}>
        <boxGeometry args={[1.55, 0.055, 0.42]} />
        <Mat role="panel" />
      </mesh>
      <mesh position={[0, 1.68, 0.02]}>
        <boxGeometry args={[1.55, 0.055, 0.42]} />
        <Mat role="panel" />
      </mesh>
      {/* books */}
      {books.map((b, i) => (
        <mesh key={i} position={[b.x, b.y, 0.02]}>
          <boxGeometry args={[b.w, b.h, 0.3]} />
          <meshStandardMaterial userData={{ role: "tinted" }} color={b.tint} roughness={0.9} />
        </mesh>
      ))}
      {/* the one book that matters */}
      <mesh position={[0.45, 1.19, 0.06]} rotation={[0, 0, -0.12]}>
        <boxGeometry args={[0.13, 0.36, 0.32]} />
        <Mat role="glow" roughness={0.5} />
      </mesh>
    </group>
  );
}

function Lectern() {
  return (
    <group>
      <mesh castShadow position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.32, 0.38, 0.1, 20]} />
        <Mat role="body" />
      </mesh>
      <mesh castShadow position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.085, 0.11, 1.0, 12]} />
        <Mat role="body" />
      </mesh>
      {/* sloped desk */}
      <mesh castShadow position={[0, 1.06, 0.05]} rotation={[-0.38, 0, 0]}>
        <boxGeometry args={[0.78, 0.06, 0.56]} />
        <Mat role="panel" />
      </mesh>
      {/* open book: two page blocks */}
      <mesh position={[-0.17, 1.12, 0.07]} rotation={[-0.38, 0, 0.08]}>
        <boxGeometry args={[0.32, 0.035, 0.44]} />
        <Mat role="panel" roughness={0.98} />
      </mesh>
      <mesh position={[0.17, 1.12, 0.07]} rotation={[-0.38, 0, -0.08]}>
        <boxGeometry args={[0.32, 0.035, 0.44]} />
        <Mat role="panel" roughness={0.98} />
      </mesh>
      {/* glowing script */}
      <mesh position={[-0.17, 1.15, 0.08]} rotation={[-0.38, 0, 0.08]}>
        <boxGeometry args={[0.22, 0.012, 0.3]} />
        <Mat role="glow" roughness={0.5} />
      </mesh>
      <mesh position={[0.17, 1.15, 0.08]} rotation={[-0.38, 0, -0.08]}>
        <boxGeometry args={[0.22, 0.012, 0.3]} />
        <Mat role="glowSoft" roughness={0.5} />
      </mesh>
    </group>
  );
}

function Machine() {
  return (
    <group>
      <mesh castShadow position={[0, 0.13, 0]}>
        <boxGeometry args={[1.3, 0.26, 1.1]} />
        <Mat role="panel" />
      </mesh>
      {/* core column */}
      <mesh castShadow position={[0, 0.95, 0]}>
        <cylinderGeometry args={[0.42, 0.46, 1.4, 20]} />
        <Mat role="body" metalness={0.25} />
      </mesh>
      <mesh castShadow position={[0, 1.68, 0]} scale={[1, 0.55, 1]}>
        <sphereGeometry args={[0.42, 20, 14]} />
        <Mat role="body" metalness={0.25} />
      </mesh>
      {/* energized window band */}
      <mesh position={[0, 1.02, 0]}>
        <cylinderGeometry args={[0.435, 0.435, 0.2, 20]} />
        <Mat role="glow" roughness={0.35} />
      </mesh>
      {/* pipes */}
      <mesh castShadow position={[-0.56, 0.8, 0.22]} rotation={[0, 0, 0.1]}>
        <cylinderGeometry args={[0.05, 0.05, 1.15, 8]} />
        <Mat role="panel" metalness={0.35} roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0.56, 0.8, -0.18]} rotation={[0, 0, -0.1]}>
        <cylinderGeometry args={[0.05, 0.05, 1.15, 8]} />
        <Mat role="panel" metalness={0.35} roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0.32, 0.8, 0.45]} rotation={[0.08, 0, -0.06]}>
        <cylinderGeometry args={[0.04, 0.04, 1.05, 8]} />
        <Mat role="panel" metalness={0.35} roughness={0.6} />
      </mesh>
      {/* front gauge */}
      <mesh position={[0, 0.62, 0.47]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.06, 16]} />
        <Mat role="panel" />
      </mesh>
      <mesh position={[0, 0.62, 0.505]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.02, 16]} />
        <Mat role="glowSoft" roughness={0.4} />
      </mesh>
    </group>
  );
}

function Pedestal() {
  const { reducedMotion } = useContext(SceneContext);
  const crystalRef = useRef();
  useFrame((state) => {
    if (!crystalRef.current || reducedMotion) return;
    const t = state.clock.elapsedTime;
    crystalRef.current.rotation.y = t * 0.6;
    crystalRef.current.position.y = 1.58 + Math.sin(t * 1.3) * 0.055;
  });
  return (
    <group>
      <mesh castShadow position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.44, 0.5, 0.1, 20]} />
        <Mat role="body" />
      </mesh>
      <mesh castShadow position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.3, 0.36, 1.0, 16]} />
        <Mat role="body" />
      </mesh>
      <mesh position={[0, 1.13, 0]}>
        <cylinderGeometry args={[0.38, 0.38, 0.07, 20]} />
        <Mat role="panel" />
      </mesh>
      {/* the artifact */}
      <mesh ref={crystalRef} castShadow position={[0, 1.58, 0]}>
        <octahedronGeometry args={[0.28]} />
        <Mat role="glow" roughness={0.25} metalness={0.2} />
      </mesh>
      {/* halo ring */}
      <mesh position={[0, 1.58, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.4, 0.018, 10, 40]} />
        <Mat role="glowSoft" roughness={0.4} />
      </mesh>
    </group>
  );
}

/* ---- Registry ----------------------------------------------------------- */

const ARCHETYPES = {
  console: { Component: Console, labelY: 1.75, sparkleY: 1.1 },
  wallPanel: { Component: WallPanel, labelY: 1.0, sparkleY: 0 },
  door: { Component: Door, labelY: 3.35, sparkleY: 1.6 },
  cabinet: { Component: Cabinet, labelY: 2.35, sparkleY: 1.2 },
  shelf: { Component: Shelf, labelY: 2.5, sparkleY: 1.2 },
  lectern: { Component: Lectern, labelY: 1.75, sparkleY: 1.2 },
  machine: { Component: Machine, labelY: 2.3, sparkleY: 1.1 },
  pedestal: { Component: Pedestal, labelY: 2.2, sparkleY: 1.5 },
};

const STATE_LABEL = {
  locked: "Locked",
  active: "Inspect",
  solved: "Solved ✓",
};

/* ---- Interactive wrapper ------------------------------------------------ */

const BLACK = new THREE.Color("#000000");

/**
 * Wraps an archetype with state-driven materials, hover highlight + label,
 * solve pulse, and a floor hover-ring. `state`: locked|active|solved|decor.
 */
export function InteractiveProp({ prop, state, tokens, family, enabled, onSelect }) {
  const { reducedMotion, paletteHints } = useContext(SceneContext);
  const groupRef = useRef();
  const scaleRef = useRef();
  const ringMatRef = useRef();
  const ringMeshRef = useRef();
  const materialsRef = useRef([]);
  const animRef = useRef({ hover: 0, pulse: 0, snapped: false });
  const prevStateRef = useRef(state);
  const [hovered, setHovered] = useState(false);

  const def = ARCHETYPES[prop.archetype] || ARCHETYPES.pedestal;
  const clickable = enabled && prop.interactive;

  // Each prop deterministically picks one scene.palette color as its cast.
  const tint = paletteHints.length > 0
    ? paletteHints[Math.floor(prop.seed * paletteHints.length) % paletteHints.length]
    : null;

  const targets = useMemo(() => {
    const p = propStatePalette(tokens, state, tint);
    return { ...p, glowBase: p.glow.clone().multiplyScalar(0.12) };
  }, [tokens, state, tint]);

  // Collect role-tagged materials once; archetype geometry is static.
  // The family finish (metallic vs matte) is baked in at the same time.
  useEffect(() => {
    const finish = FAMILY_FINISH[family] || { metalBoost: 0, roughShift: 0 };
    const mats = [];
    groupRef.current?.traverse((o) => {
      if (o.isMesh && o.material?.userData?.role && o.material.userData.role !== "tinted") {
        o.material.metalness = THREE.MathUtils.clamp(o.material.metalness + finish.metalBoost, 0, 1);
        o.material.roughness = THREE.MathUtils.clamp(o.material.roughness + finish.roughShift, 0.05, 1);
        mats.push(o.material);
      }
    });
    materialsRef.current = mats;
    animRef.current.snapped = false;
  }, [family]);

  // Solve flourish: pulse once on active -> solved.
  useEffect(() => {
    if (prevStateRef.current !== "solved" && state === "solved") {
      animRef.current.pulse = 1;
    }
    prevStateRef.current = state;
    animRef.current.snapped = false; // re-converge quickly on any state change
  }, [state]);

  useFrame((frame, dt) => {
    const anim = animRef.current;
    const k = anim.snapped ? 1 - Math.exp(-7 * Math.min(dt, 0.1)) : 1;
    const t = frame.clock.elapsedTime;

    anim.hover = THREE.MathUtils.lerp(anim.hover, hovered && clickable ? 1 : 0, k);
    if (anim.pulse > 0) anim.pulse = Math.max(0, anim.pulse - dt * 1.4);
    const pulseWave = reducedMotion ? 0 : Math.sin(anim.pulse * Math.PI) * anim.pulse;

    // Idle life: active objects breathe their glow; locked ones carry a
    // faint slow heartbeat under the dimming so they read "sealed", not
    // "broken". Phase-shifted per prop so the room never pulses in sync.
    let breathe = 1;
    if (!reducedMotion) {
      if (state === "active") breathe = 1 + 0.16 * Math.sin(t * 1.7 + prop.seed * Math.PI * 2);
      else if (state === "locked") breathe = 1 + 0.45 * Math.sin(t * 0.85 + prop.seed * Math.PI * 2);
    }

    const glowMult = (1 + anim.hover * 0.9 + pulseWave * 2.2) * breathe;
    for (const m of materialsRef.current) {
      const role = m.userData.role;
      if (role === "body") m.color.lerp(targets.body, k);
      else if (role === "panel") m.color.lerp(targets.panel, k);
      else if (role === "glow") {
        m.color.lerp(targets.glowBase, k);
        m.emissive.lerp(targets.glow, k);
        m.emissiveIntensity = THREE.MathUtils.lerp(
          m.emissiveIntensity, targets.glowIntensity * glowMult, k
        );
      } else if (role === "glowSoft") {
        m.color.lerp(BLACK, k * 0.5);
        m.emissive.lerp(targets.glow, k);
        m.emissiveIntensity = THREE.MathUtils.lerp(
          m.emissiveIntensity, targets.softIntensity * glowMult, k
        );
      }
    }

    if (scaleRef.current) {
      const s = 1 + anim.hover * 0.035 + pulseWave * 0.09;
      scaleRef.current.scale.setScalar(s);
    }
    if (ringMatRef.current && ringMeshRef.current) {
      // The floor ring doubles as the solve ripple: it flares and expands
      // outward once as the pulse decays, then returns to hover duty.
      ringMatRef.current.opacity = THREE.MathUtils.lerp(
        ringMatRef.current.opacity,
        Math.max(anim.hover * 0.45, pulseWave * 0.6),
        k
      );
      ringMatRef.current.color.lerp(targets.glow, k);
      ringMeshRef.current.scale.setScalar(anim.pulse > 0 ? 1 + (1 - anim.pulse) * 1.15 : 1);
    }
    anim.snapped = true;
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

  // Wall-mounted groups originate at hang height; drop the ring to the floor.
  const ringY = 0.02 - prop.position[1];
  const ringZ = prop.wallMounted ? 0.95 : 0;

  return (
    <group
      ref={groupRef}
      position={prop.position}
      rotation={[0, prop.rotationY, 0]}
      onClick={handleClick}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
    >
      <group ref={scaleRef}>
        <def.Component seed={prop.seed} />
      </group>

      {/* hover ring on the floor (also the solve ripple) */}
      <mesh ref={ringMeshRef} position={[0, ringY, ringZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 0.86, 40]} />
        <meshBasicMaterial ref={ringMatRef} transparent opacity={0} depthWrite={false} />
      </mesh>

      {state === "solved" && (
        <Sparkles
          count={22}
          scale={[1.5, 1.6, 1.5]}
          position={[0, def.sparkleY, prop.wallMounted ? 0.4 : 0]}
          size={2.6}
          speed={reducedMotion ? 0 : 0.35}
          opacity={0.65}
          color={tokens.accent}
        />
      )}

      {hovered && clickable && (
        <Html position={[0, def.labelY, 0]} center distanceFactor={7} zIndexRange={[20, 0]}>
          <div className={`obj-label obj-label--${state}`}>
            <span className="obj-label-name">{prop.label}</span>
            <span className="obj-label-state">{STATE_LABEL[state] || state}</span>
          </div>
        </Html>
      )}
    </group>
  );
}
