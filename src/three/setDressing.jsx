/* =========================================================================
   Set dressing — the server's decor manifest, made physical.

   The backend decides what inhabits the room (scene.decor: kinds, counts,
   a placement seed); this module renders EXACTLY that manifest. The
   count contract is load-bearing: observation puzzles ask the player to
   count these objects, so every instance is one clearly countable unit,
   all instances are placed (placement can degrade to corner slots but
   never drops an item), and nothing here is interactive — decor meshes
   are raycast-transparent so they can never block a puzzle prop's click.

   Placement is seeded (mulberry32 on decor.seed): deterministic per room,
   clustered around corner anchors so the space reads inhabited rather
   than uniformly sprinkled. Rooms saved before decor existed get a
   fallback manifest keyed off the theme hash — purely visual, since no
   observation puzzle can reference it.
   ========================================================================= */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ROOM, EXIT, hash01 } from "./layoutRoom";

const { halfW, halfD } = ROOM;

/* ---- Seeded RNG ---------------------------------------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- Fallback manifest (pre-decor rooms) ---------------------------------- */

const FALLBACK_CATALOG = {
  "sci-fi": [
    { kind: "crate", label: "supply crates" },
    { kind: "canister", label: "pressure canisters" },
    { kind: "monitor", label: "wall monitors", wall: true },
    { kind: "beacon", label: "warning beacons" },
  ],
  fantasy: [
    { kind: "barrel", label: "oak barrels" },
    { kind: "tome", label: "fallen tomes" },
    { kind: "candle", label: "burning candles" },
    { kind: "banner", label: "hanging banners", wall: true },
  ],
  "horror-gothic": [
    { kind: "candle", label: "guttering candles" },
    { kind: "skull", label: "pale skulls" },
    { kind: "crate", label: "rotting crates" },
    { kind: "lantern", label: "iron lanterns" },
  ],
  "noir-mystery": [
    { kind: "filebox", label: "case-file boxes" },
    { kind: "bottle", label: "empty bottles" },
    { kind: "newspaper", label: "newspaper bundles" },
    { kind: "lamp", label: "standing lamps" },
  ],
  nature: [
    { kind: "fern", label: "young ferns" },
    { kind: "rock", label: "mossy stones" },
    { kind: "mushroom", label: "glowing mushrooms" },
    { kind: "log", label: "fallen logs" },
  ],
  cyberpunk: [
    { kind: "crate", label: "road cases" },
    { kind: "cable", label: "cable bundles" },
    { kind: "neon", label: "neon signs", wall: true },
    { kind: "canister", label: "coolant canisters" },
  ],
};

export function buildFallbackManifest(family, themeText) {
  const catalog = FALLBACK_CATALOG[family] || FALLBACK_CATALOG["sci-fi"];
  const counts = [3, 4, 2, 5];
  return {
    seed: Math.max(1, Math.floor(hash01(themeText || family) * 2 ** 31)),
    items: catalog.map((entry, i) => ({ ...entry, count: counts[i % counts.length] })),
  };
}

/* ---- Placement ------------------------------------------------------------ */

const FLOOR_LIMIT_X = 7.35;
const FLOOR_LIMIT_Z = 5.35;
const RING_X = 6.05; // outside the interactive props' interior band
const RING_Z = 4.55;
const PROP_CLEARANCE = 1.85; // props + their vignette companions
const DECOR_GAP = 0.85;

function inExitCorridor(x, z) {
  return z < -4.25 && Math.abs(x) < 3.2;
}

function inRing(x, z) {
  return Math.abs(x) > RING_X || Math.abs(z) > RING_Z;
}

/** Deterministic last-resort slots along the +z wall corners. */
function fallbackSlot(i) {
  const side = i % 2 === 0 ? 1 : -1;
  return [side * (7.0 - Math.floor(i / 2) * 1.1), 0, 4.9 - (i % 3) * 0.35];
}

function placeFloorDecor(rng, total, floorProps) {
  const anchors = Array.from({ length: 3 }, () => {
    const corner = [
      [-6.8, -4.9], [6.8, -4.9], [-6.8, 4.9], [6.8, 4.9], [0, 5.0], [-6.9, 0], [6.9, 0],
    ][Math.floor(rng() * 7)];
    return corner;
  });
  const placed = [];
  for (let i = 0; i < total; i++) {
    let found = null;
    for (let attempt = 0; attempt < 80 && !found; attempt++) {
      let x;
      let z;
      if (rng() < 0.65) {
        const [ax, az] = anchors[Math.floor(rng() * anchors.length)];
        const angle = rng() * Math.PI * 2;
        const r = 0.35 + rng() * 1.15;
        x = ax + Math.cos(angle) * r;
        z = az + Math.sin(angle) * r;
      } else {
        x = (rng() * 2 - 1) * FLOOR_LIMIT_X;
        z = (rng() * 2 - 1) * FLOOR_LIMIT_Z;
      }
      if (Math.abs(x) > FLOOR_LIMIT_X || Math.abs(z) > FLOOR_LIMIT_Z) continue;
      if (!inRing(x, z)) continue;
      if (inExitCorridor(x, z)) continue;
      if (floorProps.some(([px, pz]) => Math.hypot(x - px, z - pz) < PROP_CLEARANCE)) continue;
      if (placed.some(([px, , pz]) => Math.hypot(x - px, z - pz) < DECOR_GAP)) continue;
      found = [x, 0, z];
    }
    placed.push(found || fallbackSlot(placed.length));
  }
  return placed.map((pos, i) => ({ position: pos, rotY: rng() * Math.PI * 2, key: i }));
}

const WALL_DEFS = [
  { id: "+x", pin: [halfW - 0.32, 0], axis: "z", limit: halfD - 1.6, rotY: -Math.PI / 2 },
  { id: "-x", pin: [-halfW + 0.32, 0], axis: "z", limit: halfD - 1.6, rotY: Math.PI / 2 },
  { id: "+z", pin: [0, halfD - 0.32], axis: "x", limit: halfW - 1.6, rotY: Math.PI },
  { id: "-z", pin: [0, -halfD + 0.32], axis: "x", limit: halfW - 1.6, rotY: 0 },
];

function placeWallDecor(rng, total, wallProps) {
  const placed = [];
  for (let i = 0; i < total; i++) {
    let found = null;
    for (let attempt = 0; attempt < 60 && !found; attempt++) {
      const wall = WALL_DEFS[Math.floor(rng() * WALL_DEFS.length)];
      const slide = (rng() * 2 - 1) * wall.limit;
      if (wall.id === "-z" && Math.abs(slide) < EXIT.keepout + 0.8) continue;
      const x = wall.axis === "x" ? slide : wall.pin[0];
      const z = wall.axis === "z" ? slide : wall.pin[1];
      const tooClose =
        wallProps.some(([px, pz]) => Math.hypot(x - px, z - pz) < 2.1) ||
        placed.some((p) => Math.hypot(x - p.position[0], z - p.position[2]) < 1.7);
      if (tooClose) continue;
      found = { position: [x, 2.55 + rng() * 0.6, z], rotY: wall.rotY, key: i };
    }
    // Last resort: high on the +z wall, spread by index.
    placed.push(
      found || { position: [-5 + (placed.length * 2.3) % 10, 3.4, halfD - 0.32], rotY: Math.PI, key: i }
    );
  }
  return placed;
}

/* ---- Kind geometry ---------------------------------------------------------
   One component per kind; each instance is ONE countable unit. Emissive
   materials that should live tag themselves with userData.flicker; the
   parent's single frame loop drives them all.                              */

function useDecorColors(tokens) {
  return useMemo(
    () => ({
      dark: new THREE.Color(tokens.border).multiplyScalar(0.8),
      darker: new THREE.Color(tokens.border).multiplyScalar(0.5),
      surfaceDim: new THREE.Color(tokens.surface).multiplyScalar(0.7),
      primary: new THREE.Color(tokens.primary),
      accent: new THREE.Color(tokens.accent),
      primaryDim: new THREE.Color(tokens.primary).multiplyScalar(0.4),
    }),
    [tokens]
  );
}

function Flame({ color = "#e8a04c", size = 0.028, y = 0, intensity = 2.2, speed = 6 }) {
  return (
    <mesh position={[0, y, 0]}>
      <sphereGeometry args={[size, 8, 6]} />
      <meshStandardMaterial
        color="#080808"
        emissive={color}
        emissiveIntensity={intensity}
        roughness={0.5}
        userData={{ flicker: { base: intensity, depth: 0.45, speed } }}
      />
    </mesh>
  );
}

const KINDS = {
  crate: ({ c, family }) => (
    <group rotation={[0, 0, family === "horror-gothic" ? 0.03 : 0]}>
      <mesh castShadow position={[0, 0.26, 0]}>
        <boxGeometry args={[0.52, 0.52, 0.46]} />
        <meshStandardMaterial
          color={c.dark}
          roughness={family === "horror-gothic" ? 0.98 : 0.55}
          metalness={family === "horror-gothic" ? 0 : 0.3}
        />
      </mesh>
      <mesh position={[0, 0.45, 0.232]}>
        <boxGeometry args={[0.3, 0.05, 0.012]} />
        <meshStandardMaterial
          color="#080808"
          emissive={family === "horror-gothic" ? c.darker : c.primary}
          emissiveIntensity={family === "horror-gothic" ? 0.1 : 0.8}
          roughness={0.6}
        />
      </mesh>
    </group>
  ),
  canister: ({ c }) => (
    <group>
      <mesh castShadow position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.6, 10]} />
        <meshStandardMaterial color={c.dark} roughness={0.45} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.44, 0]}>
        <cylinderGeometry args={[0.135, 0.135, 0.05, 10]} />
        <meshStandardMaterial color="#080808" emissive={c.accent} emissiveIntensity={0.9} roughness={0.5} />
      </mesh>
    </group>
  ),
  monitor: ({ c }) => (
    <group>
      <mesh castShadow position={[0, 0, 0.05]}>
        <boxGeometry args={[0.72, 0.5, 0.07]} />
        <meshStandardMaterial color={c.darker} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.095]}>
        <boxGeometry args={[0.6, 0.38, 0.015]} />
        <meshStandardMaterial
          color="#080808"
          emissive={c.primary}
          emissiveIntensity={0.9}
          roughness={0.35}
          userData={{ flicker: { base: 0.9, depth: 0.12, speed: 11 } }}
        />
      </mesh>
    </group>
  ),
  beacon: ({ c }) => (
    <group>
      <mesh castShadow position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.09, 0.13, 0.44, 8]} />
        <meshStandardMaterial color={c.darker} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial
          color="#080808"
          emissive={c.accent}
          emissiveIntensity={1.8}
          roughness={0.4}
          userData={{ flicker: { base: 1.8, depth: 0.8, speed: 2.2, pulse: true } }}
        />
      </mesh>
    </group>
  ),
  barrel: ({ c }) => (
    <group>
      <mesh castShadow position={[0, 0.29, 0]}>
        <cylinderGeometry args={[0.24, 0.2, 0.58, 10]} />
        <meshStandardMaterial color={c.dark} roughness={0.95} />
      </mesh>
      {[0.14, 0.44].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.228, 0.016, 6, 16]} />
          <meshStandardMaterial color={c.darker} roughness={0.7} metalness={0.3} />
        </mesh>
      ))}
    </group>
  ),
  tome: ({ c }) => (
    <group>
      <mesh castShadow position={[0, 0.05, 0]} rotation={[0, 0.3, 0]}>
        <boxGeometry args={[0.4, 0.1, 0.3]} />
        <meshStandardMaterial color={c.dark} roughness={0.95} />
      </mesh>
      <mesh position={[0.14, 0.055, 0]} rotation={[0, 0.3, 0]}>
        <boxGeometry args={[0.11, 0.085, 0.28]} />
        <meshStandardMaterial color="#d9cfae" roughness={1} />
      </mesh>
    </group>
  ),
  candle: ({ c: _c }) => (
    <group>
      <mesh position={[0, 0.11, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.22, 8]} />
        <meshStandardMaterial color="#c9bda6" roughness={0.95} />
      </mesh>
      <Flame y={0.26} />
    </group>
  ),
  banner: ({ c }) => (
    <group>
      <mesh position={[0, 0.75, 0.05]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.8, 6]} />
        <meshStandardMaterial color={c.darker} roughness={0.7} metalness={0.3} />
      </mesh>
      <mesh castShadow position={[0, 0, 0.06]}>
        <boxGeometry args={[0.62, 1.5, 0.02]} />
        <meshStandardMaterial color={c.primaryDim} roughness={0.95} />
      </mesh>
      <mesh position={[0, -0.45, 0.075]}>
        <boxGeometry args={[0.4, 0.4, 0.012]} />
        <meshStandardMaterial color="#080808" emissive={c.accent} emissiveIntensity={0.35} roughness={0.8} />
      </mesh>
    </group>
  ),
  skull: () => (
    <group>
      <mesh castShadow position={[0, 0.09, 0]} scale={[1, 0.85, 1.1]}>
        <icosahedronGeometry args={[0.1, 1]} />
        <meshStandardMaterial color="#b8ad98" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.05, 0.085]}>
        <boxGeometry args={[0.09, 0.035, 0.04]} />
        <meshStandardMaterial color="#0a0806" roughness={1} />
      </mesh>
    </group>
  ),
  lantern: ({ c }) => (
    <group>
      <mesh castShadow position={[0, 0.16, 0]}>
        <boxGeometry args={[0.18, 0.26, 0.18]} />
        <meshStandardMaterial color={c.darker} roughness={0.85} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.31, 0]}>
        <coneGeometry args={[0.13, 0.08, 4]} />
        <meshStandardMaterial color={c.darker} roughness={0.85} metalness={0.2} />
      </mesh>
      <Flame y={0.16} size={0.045} intensity={1.8} speed={4.5} />
    </group>
  ),
  filebox: ({ c }) => (
    <group>
      <mesh castShadow position={[0, 0.15, 0]}>
        <boxGeometry args={[0.46, 0.3, 0.34]} />
        <meshStandardMaterial color={c.dark} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.19, 0.172]}>
        <boxGeometry args={[0.3, 0.12, 0.01]} />
        <meshStandardMaterial color="#d9cfae" roughness={1} />
      </mesh>
    </group>
  ),
  bottle: ({ c }) => (
    <group>
      <mesh castShadow position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.05, 0.055, 0.28, 8]} />
        <meshStandardMaterial color={c.surfaceDim} roughness={0.25} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.33, 0]}>
        <cylinderGeometry args={[0.018, 0.03, 0.12, 8]} />
        <meshStandardMaterial color={c.surfaceDim} roughness={0.25} metalness={0.1} />
      </mesh>
    </group>
  ),
  newspaper: ({ c: _c }) => (
    <group>
      <mesh castShadow position={[0, 0.07, 0]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.38, 0.14, 0.28]} />
        <meshStandardMaterial color="#a89f8c" roughness={1} />
      </mesh>
      <mesh position={[0, 0.07, 0]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.4, 0.03, 0.05]} />
        <meshStandardMaterial color="#4a4238" roughness={0.9} />
      </mesh>
    </group>
  ),
  lamp: ({ c }) => (
    <group>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.16, 0.19, 0.06, 10]} />
        <meshStandardMaterial color={c.darker} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.4, 6]} />
        <meshStandardMaterial color={c.darker} roughness={0.8} metalness={0.2} />
      </mesh>
      <mesh position={[0, 1.5, 0]}>
        <coneGeometry args={[0.17, 0.2, 12, 1, true]} />
        <meshStandardMaterial color={c.dark} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      <Flame color="#f2e6c8" size={0.05} y={1.44} intensity={1.6} speed={1.4} />
    </group>
  ),
  fern: ({ c }) => (
    <group>
      {[[0, 0.36, 0.1], [0.09, 0.46, -0.3], [-0.08, 0.3, 0.42], [0.02, 0.4, 0.8]].map(([x, h, tilt], i) => (
        <mesh key={i} castShadow position={[x, h / 2, x * 0.6]} rotation={[tilt * 0.35, i, tilt]}>
          <coneGeometry args={[0.08, h, 6]} />
          <meshStandardMaterial color={c.primaryDim} roughness={1} />
        </mesh>
      ))}
    </group>
  ),
  rock: ({ c }) => (
    <mesh castShadow position={[0, 0.14, 0]} scale={[1.25, 0.7, 1]}>
      <icosahedronGeometry args={[0.22, 0]} />
      <meshStandardMaterial color={c.surfaceDim} roughness={1} />
    </mesh>
  ),
  mushroom: ({ c }) => (
    <group>
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.035, 0.05, 0.18, 8]} />
        <meshStandardMaterial color="#cfc4a8" roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0, 0.2, 0]} scale={[1, 0.55, 1]}>
        <sphereGeometry args={[0.12, 10, 8]} />
        <meshStandardMaterial
          color="#080808"
          emissive={c.accent}
          emissiveIntensity={0.9}
          roughness={0.7}
          userData={{ flicker: { base: 0.9, depth: 0.25, speed: 1.1 } }}
        />
      </mesh>
    </group>
  ),
  log: ({ c }) => (
    <group>
      <mesh castShadow position={[0, 0.13, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.13, 0.15, 0.9, 9]} />
        <meshStandardMaterial color={c.darker} roughness={1} />
      </mesh>
      <mesh position={[0.451, 0.13, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.128, 0.128, 0.01, 9]} />
        <meshStandardMaterial color="#8a7a5c" roughness={1} />
      </mesh>
    </group>
  ),
  cable: ({ c }) => (
    <mesh castShadow position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.2, 0.05, 8, 20]} />
      <meshStandardMaterial color={c.darker} roughness={0.7} />
    </mesh>
  ),
  neon: ({ c }) => (
    <group>
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[0.9, 0.42, 0.05]} />
        <meshStandardMaterial color="#0c0c12" roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.075]}>
        <boxGeometry args={[0.74, 0.08, 0.015]} />
        <meshStandardMaterial
          color="#080808"
          emissive={c.primary}
          emissiveIntensity={2.2}
          roughness={0.4}
          userData={{ flicker: { base: 2.2, depth: 0.5, speed: 13, jitter: true } }}
        />
      </mesh>
      <mesh position={[0, -0.12, 0.075]}>
        <boxGeometry args={[0.5, 0.05, 0.015]} />
        <meshStandardMaterial color="#080808" emissive={c.accent} emissiveIntensity={1.6} roughness={0.4} />
      </mesh>
    </group>
  ),
};

/* ---- Main ------------------------------------------------------------------ */

const NO_RAYCAST = () => null;

export function SetDressing({ decor, layout, family, tokens, reducedMotion }) {
  const groupRef = useRef();
  const flickerRef = useRef([]);
  const colors = useDecorColors(tokens);

  // Expand the manifest into placed instances, deterministically from the
  // manifest seed. Floor and wall items are placed by separate passes.
  const instances = useMemo(() => {
    const items = decor?.items || [];
    const rng = mulberry32(decor?.seed || 1);
    const floorProps = (layout || [])
      .filter((p) => !p.wallMounted && !p.exitDoor)
      .map((p) => [p.position[0], p.position[2]]);
    const wallProps = (layout || [])
      .filter((p) => p.wallMounted || p.exitDoor)
      .map((p) => [p.position[0], p.position[2]]);

    const floorItems = [];
    const wallItems = [];
    for (const item of items) {
      if (!KINDS[item.kind]) continue;
      for (let i = 0; i < item.count; i++) {
        (item.wall ? wallItems : floorItems).push(item.kind);
      }
    }
    const floorSpots = placeFloorDecor(rng, floorItems.length, floorProps);
    const wallSpots = placeWallDecor(rng, wallItems.length, wallProps);
    return [
      ...floorItems.map((kind, i) => ({ kind, ...floorSpots[i], key: `f${i}` })),
      ...wallItems.map((kind, i) => ({ kind, ...wallSpots[i], key: `w${i}` })),
    ];
  }, [decor, layout]);

  // One traverse: make every decor mesh raycast-transparent (decor must
  // never eat a puzzle prop's click) and collect the flicker-tagged
  // emissive materials for the single frame loop below.
  useEffect(() => {
    const flickers = [];
    groupRef.current?.traverse((o) => {
      if (o.isMesh) {
        o.raycast = NO_RAYCAST;
        const f = o.material?.userData?.flicker;
        if (f) flickers.push({ mat: o.material, ...f, phase: Math.random() * Math.PI * 2 });
      }
    });
    flickerRef.current = flickers;
  }, [instances, family]);

  useFrame((state) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime;
    for (const f of flickerRef.current) {
      let level;
      if (f.pulse) {
        level = 0.5 + 0.5 * Math.sin(t * f.speed + f.phase); // beacon sweep
      } else if (f.jitter) {
        // neon: mostly on, with occasional dropouts
        const n = Math.sin(t * f.speed + f.phase) * Math.sin(t * 2.3 + f.phase * 1.7);
        level = n < -0.82 ? 0.15 : 1;
      } else {
        level =
          0.72 +
          0.28 * Math.sin(t * f.speed + f.phase) * Math.sin(t * f.speed * 0.53 + f.phase * 2.1);
      }
      f.mat.emissiveIntensity = f.base * (1 - f.depth + f.depth * level);
    }
  });

  return (
    <group ref={groupRef}>
      {instances.map((inst) => {
        const Kind = KINDS[inst.kind];
        return (
          <group key={inst.key} position={inst.position} rotation={[0, inst.rotY, 0]}>
            <Kind c={colors} family={family} />
          </group>
        );
      })}
    </group>
  );
}

export default SetDressing;
