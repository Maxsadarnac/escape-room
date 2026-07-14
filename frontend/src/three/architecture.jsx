/* =========================================================================
   Architecture — the layer between "six planes" and "a built place".

   Family-specific structural rhythm: vertical ribs along the walls, a
   wainscot band, cornice, floor inlay, and a ceiling centerpiece (several
   of them animated: the noir fan, the fantasy chandelier, the cyberpunk
   holo-ring, the horror lantern). Plus volumetric-ish light shafts where a
   family's light rig motivates one.

   Everything is primitive geometry colored from the family tokens; ribs
   skip spans occupied by wall-mounted props and the exit door.
   ========================================================================= */

import { useContext, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ROOM, EXIT } from "./layoutRoom";
import { SceneContext } from "./SceneContext";

const { halfW, halfD, width, depth, height } = ROOM;

const col = (hex) => new THREE.Color(hex);
const scaled = (c, s) => c.clone().multiplyScalar(s);

/* ---- Rib placement -------------------------------------------------------
   Fixed slots per wall; slots within 1.35 of a wall prop (or the exit door
   span) are dropped so ribs never stab through a hanging panel.            */

const RIB_SLOTS = [
  { wall: "-x", x: -halfW + 0.09, zs: [-4.4, -1.5, 1.5, 4.4], rotY: Math.PI / 2 },
  { wall: "+x", x: halfW - 0.09, zs: [-4.4, -1.5, 1.5, 4.4], rotY: -Math.PI / 2 },
  { wall: "+z", z: halfD - 0.09, xs: [-5.7, -2, 2, 5.7], rotY: Math.PI },
  { wall: "-z", z: -halfD + 0.09, xs: [-5.7, 5.7], rotY: 0 },
];

function ribPositions(layout) {
  const occupied = { "-x": [], "+x": [], "+z": [], "-z": [] };
  for (const prop of layout || []) {
    if (!prop.wallMounted || prop.exitDoor) continue;
    const [x, , z] = prop.position;
    if (Math.abs(Math.abs(x) - halfW) < 0.5) occupied[x < 0 ? "-x" : "+x"].push(z);
    else if (Math.abs(Math.abs(z) - halfD) < 0.5) occupied[z < 0 ? "-z" : "+z"].push(x);
  }
  const out = [];
  for (const slot of RIB_SLOTS) {
    const slides = slot.zs || slot.xs;
    for (const s of slides) {
      if (occupied[slot.wall].some((o) => Math.abs(o - s) < 1.35)) continue;
      out.push({
        position: slot.zs ? [slot.x, 0, s] : [s, 0, slot.z],
        rotY: slot.rotY,
        key: `${slot.wall}${s}`,
      });
    }
  }
  return out;
}

/* ---- Rib variants (drawn facing +z, rotated into place) ------------------ */

function Rib({ variant, tokens, base }) {
  switch (variant) {
    case "pilaster": // fantasy: stone shaft with base + capital
      return (
        <group>
          <mesh castShadow position={[0, 0.22, 0.16]}>
            <boxGeometry args={[0.54, 0.44, 0.34]} />
            <meshStandardMaterial color={base} roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, 2.3, 0.12]}>
            <boxGeometry args={[0.36, 3.8, 0.24]} />
            <meshStandardMaterial color={base} roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, 4.4, 0.16]}>
            <boxGeometry args={[0.54, 0.3, 0.34]} />
            <meshStandardMaterial color={base} roughness={0.9} />
          </mesh>
        </group>
      );
    case "timber": // horror: dark stud with a corbel at the top
      return (
        <group>
          <mesh castShadow position={[0, height / 2, 0.1]}>
            <boxGeometry args={[0.3, height, 0.2]} />
            <meshStandardMaterial color={base} roughness={0.95} />
          </mesh>
          <mesh castShadow position={[0, height - 0.5, 0.19]}>
            <boxGeometry args={[0.38, 0.34, 0.34]} />
            <meshStandardMaterial color={base} roughness={0.95} />
          </mesh>
        </group>
      );
    case "trunk": // nature: a living column
      return (
        <group>
          <mesh castShadow position={[0, height / 2, 0.14]}>
            <cylinderGeometry args={[0.15, 0.24, height, 8]} />
            <meshStandardMaterial color={base} roughness={1} />
          </mesh>
          <mesh position={[0, height - 0.55, 0.3]} scale={[1.25, 0.7, 1.25]}>
            <icosahedronGeometry args={[0.62, 0]} />
            <meshStandardMaterial color={scaled(col(tokens.primary), 0.25)} roughness={1} />
          </mesh>
        </group>
      );
    case "pipe": // cyberpunk: conduit with a junction box + LED
      return (
        <group>
          <mesh castShadow position={[0, height / 2, 0.12]}>
            <cylinderGeometry args={[0.09, 0.09, height, 8]} />
            <meshStandardMaterial color={base} roughness={0.5} metalness={0.5} />
          </mesh>
          <mesh position={[0, 2.5, 0.16]}>
            <boxGeometry args={[0.26, 0.34, 0.18]} />
            <meshStandardMaterial color={scaled(base, 1.3)} roughness={0.6} metalness={0.4} />
          </mesh>
          <mesh position={[0, 2.5, 0.26]}>
            <boxGeometry args={[0.06, 0.1, 0.02]} />
            <meshStandardMaterial
              color="#080808"
              emissive={col(tokens.accent)}
              emissiveIntensity={1.6}
              roughness={0.5}
            />
          </mesh>
        </group>
      );
    case "panel": // sci-fi: flat structural rib with an emissive slot
      return (
        <group>
          <mesh castShadow position={[0, height / 2, 0.08]}>
            <boxGeometry args={[0.42, height, 0.16]} />
            <meshStandardMaterial color={base} roughness={0.55} metalness={0.35} />
          </mesh>
          <mesh position={[0, 2.6, 0.17]}>
            <boxGeometry args={[0.06, 2.6, 0.02]} />
            <meshStandardMaterial
              color="#080808"
              emissive={col(tokens.primary)}
              emissiveIntensity={0.85}
              roughness={0.5}
            />
          </mesh>
        </group>
      );
    default: // noir: quiet flat pilaster
      return (
        <mesh castShadow position={[0, height / 2, 0.06]}>
          <boxGeometry args={[0.44, height, 0.12]} />
          <meshStandardMaterial color={base} roughness={0.85} />
        </mesh>
      );
  }
}

/* ---- Perimeter bands ------------------------------------------------------ */

function Wainscot({ color }) {
  // Proud band around the base of the walls; the -z run splits around the
  // exit door opening.
  const segW = (width - EXIT.width - 1.0) / 2;
  const y = 0.62;
  const h = 0.88;
  return (
    <group>
      <mesh position={[0, y, halfD - 0.05]}>
        <boxGeometry args={[width - 0.2, h, 0.1]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[-halfW + 0.05, y, 0]}>
        <boxGeometry args={[0.1, h, depth - 0.2]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[halfW - 0.05, y, 0]}>
        <boxGeometry args={[0.1, h, depth - 0.2]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      {[-(EXIT.width / 2 + 0.5 + segW / 2), EXIT.width / 2 + 0.5 + segW / 2].map((x) => (
        <mesh key={x} position={[x, y, -halfD + 0.05]}>
          <boxGeometry args={[segW, h, 0.1]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function Cornice({ color }) {
  const y = height - 0.28;
  return (
    <group>
      {[
        { pos: [0, y, -halfD + 0.07], size: [width - 0.2, 0.2, 0.14] },
        { pos: [0, y, halfD - 0.07], size: [width - 0.2, 0.2, 0.14] },
        { pos: [-halfW + 0.07, y, 0], size: [0.14, 0.2, depth - 0.2] },
        { pos: [halfW - 0.07, y, 0], size: [0.14, 0.2, depth - 0.2] },
      ].map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function FloorInlay({ tokens, glow, trim }) {
  const ix = halfW - 1.35;
  const iz = halfD - 1.35;
  const mat = glow ? (
    <meshStandardMaterial
      color="#080808"
      emissive={col(tokens.primary)}
      emissiveIntensity={0.45}
      roughness={0.7}
    />
  ) : (
    <meshStandardMaterial color={trim} roughness={0.9} />
  );
  return (
    <group>
      {[
        { pos: [0, 0.009, -iz], size: [ix * 2, 0.018, 0.08] },
        { pos: [0, 0.009, iz], size: [ix * 2, 0.018, 0.08] },
        { pos: [-ix, 0.009, 0], size: [0.08, 0.018, iz * 2] },
        { pos: [ix, 0.009, 0], size: [0.08, 0.018, iz * 2] },
      ].map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.size} />
          {mat}
        </mesh>
      ))}
      {/* runner from the room center to the exit door */}
      <mesh position={[0, 0.009, -(iz + halfD) / 2 - 0.02]}>
        <boxGeometry args={[0.08, 0.018, halfD - iz]} />
        {mat}
      </mesh>
    </group>
  );
}

/* ---- Ceiling centerpieces ------------------------------------------------- */

function CeilingRing({ tokens }) {
  // sci-fi: a slow-turning instrument ring recessed into the ceiling
  const ref = useRef();
  const { reducedMotion } = useContext(SceneContext);
  useFrame((_, dt) => {
    if (ref.current && !reducedMotion) ref.current.rotation.z += dt * 0.06;
  });
  return (
    <group position={[0, height - 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh ref={ref}>
        <torusGeometry args={[2.35, 0.07, 10, 60]} />
        <meshStandardMaterial
          color="#080808"
          emissive={col(tokens.primary)}
          emissiveIntensity={1.1}
          roughness={0.5}
        />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} rotation={[0, 0, (i * Math.PI) / 2 + Math.PI / 4]} position={[0, 0, 0.03]}>
          <boxGeometry args={[4.4, 0.12, 0.1]} />
          <meshStandardMaterial color={scaled(col(tokens.border), 0.9)} roughness={0.6} metalness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function Chandelier({ tokens, base }) {
  // fantasy: iron candle-ring swaying gently from its chain
  const ref = useRef();
  const { reducedMotion } = useContext(SceneContext);
  useFrame((frame) => {
    if (ref.current && !reducedMotion) {
      const t = frame.clock.elapsedTime;
      ref.current.rotation.z = Math.sin(t * 0.42) * 0.028;
      ref.current.rotation.x = Math.cos(t * 0.35) * 0.02;
    }
  });
  const candles = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return [Math.cos(a) * 0.82, Math.sin(a) * 0.82];
      }),
    []
  );
  return (
    <group ref={ref} position={[0, height, 0]}>
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 1.1, 6]} />
        <meshStandardMaterial color={base} roughness={0.8} />
      </mesh>
      <mesh position={[0, -1.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.85, 0.045, 8, 40]} />
        <meshStandardMaterial color={base} roughness={0.8} metalness={0.2} />
      </mesh>
      {candles.map(([x, z], i) => (
        <group key={i} position={[x, -1.12, z]}>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.03, 0.035, 0.2, 6]} />
            <meshStandardMaterial color="#c9bda6" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.26, 0]}>
            <sphereGeometry args={[0.028, 8, 6]} />
            <meshStandardMaterial
              color="#080808"
              emissive={col(tokens.primary)}
              emissiveIntensity={2.2}
              roughness={0.5}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function SwingingLantern({ base }) {
  // horror: one lantern on a chain, swinging slowly off-center
  const ref = useRef();
  const { reducedMotion } = useContext(SceneContext);
  useFrame((frame) => {
    if (ref.current && !reducedMotion) {
      const t = frame.clock.elapsedTime;
      ref.current.rotation.x = Math.sin(t * 0.62) * 0.07;
      ref.current.rotation.z = Math.cos(t * 0.49) * 0.05;
    }
  });
  return (
    <group>
      {/* cross beams tying the existing z-beams together */}
      {[-2.8, 2.8].map((z) => (
        <mesh key={z} position={[0, height - 0.42, z]}>
          <boxGeometry args={[width - 1.2, 0.2, 0.24]} />
          <meshStandardMaterial color={base} roughness={0.95} />
        </mesh>
      ))}
      <group ref={ref} position={[2.4, height - 0.52, -2.8]}>
        <mesh position={[0, -0.55, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 1.1, 5]} />
          <meshStandardMaterial color="#111111" roughness={0.9} />
        </mesh>
        <mesh position={[0, -1.16, 0]}>
          <boxGeometry args={[0.22, 0.3, 0.22]} />
          <meshStandardMaterial color="#151210" roughness={0.9} />
        </mesh>
        <mesh position={[0, -1.16, 0]}>
          <sphereGeometry args={[0.06, 8, 6]} />
          <meshStandardMaterial
            color="#080808"
            emissive="#e8a04c"
            emissiveIntensity={2.4}
            roughness={0.5}
          />
        </mesh>
      </group>
    </group>
  );
}

function CeilingFan({ base }) {
  // noir: slow fan whose blades cut the key light — moving shadows.
  // Offset from center: the bare bulb's cord hangs near the middle.
  const ref = useRef();
  const { reducedMotion } = useContext(SceneContext);
  useFrame((_, dt) => {
    if (ref.current && !reducedMotion) ref.current.rotation.y += dt * 1.3;
  });
  return (
    <group position={[-1.9, height - 0.3, 0.5]}>
      <mesh>
        <cylinderGeometry args={[0.03, 0.03, 0.5, 6]} />
        <meshStandardMaterial color={base} roughness={0.8} />
      </mesh>
      <group ref={ref} position={[0, -0.28, 0]}>
        <mesh>
          <cylinderGeometry args={[0.1, 0.12, 0.16, 10]} />
          <meshStandardMaterial color={base} roughness={0.7} metalness={0.3} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            castShadow
            rotation={[0, (i * Math.PI) / 2, 0.1]}
            position={[
              Math.cos((i * Math.PI) / 2) * 0.75,
              0,
              -Math.sin((i * Math.PI) / 2) * 0.75,
            ]}
          >
            <boxGeometry args={[1.35, 0.025, 0.22]} />
            <meshStandardMaterial color={base} roughness={0.75} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function CanopyRing({ tokens }) {
  // nature: foliage masses ringing a gap in the canopy
  const green = scaled(col(tokens.primary), 0.24);
  const blobs = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + 0.35;
        return {
          pos: [Math.cos(a) * 2.9, height - 0.3 - (i % 3) * 0.12, Math.sin(a) * 2.6],
          s: 0.9 + ((i * 37) % 5) * 0.09,
        };
      }),
    []
  );
  return (
    <group>
      {blobs.map((b, i) => (
        <mesh key={i} position={b.pos} scale={[b.s * 1.5, b.s * 0.7, b.s * 1.5]}>
          <icosahedronGeometry args={[0.8, 0]} />
          <meshStandardMaterial color={green} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function HoloRing({ tokens }) {
  // cyberpunk: counter-rotating emissive rings under a cable tray
  const a = useRef();
  const b = useRef();
  const { reducedMotion } = useContext(SceneContext);
  useFrame((_, dt) => {
    if (reducedMotion) return;
    if (a.current) a.current.rotation.z += dt * 0.5;
    if (b.current) b.current.rotation.z -= dt * 0.34;
  });
  const cables = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => ({
        x: -6 + i * 2,
        z: i % 2 === 0 ? 1.6 : -1.6,
        len: 0.5 + ((i * 13) % 4) * 0.16,
        tilt: (((i * 29) % 7) / 7 - 0.5) * 0.5,
      })),
    []
  );
  return (
    <group>
      {[-1.6, 1.6].map((z) => (
        <mesh key={z} position={[0, height - 0.26, z]}>
          <boxGeometry args={[width - 1, 0.07, 0.5]} />
          <meshStandardMaterial color="#131320" roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
      {cables.map((c, i) => (
        <mesh key={i} position={[c.x, height - 0.55 - c.len / 2, c.z]} rotation={[0, 0, c.tilt]}>
          <cylinderGeometry args={[0.018, 0.018, c.len, 5]} />
          <meshStandardMaterial color="#0c0c14" roughness={0.9} />
        </mesh>
      ))}
      <group position={[0, height - 1.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh ref={a}>
          <torusGeometry args={[1.15, 0.028, 8, 48]} />
          <meshStandardMaterial
            color="#080808"
            emissive={col(tokens.accent)}
            emissiveIntensity={2.2}
            roughness={0.5}
          />
        </mesh>
        <mesh ref={b} position={[0, 0, 0.12]}>
          <torusGeometry args={[0.82, 0.022, 8, 40]} />
          <meshStandardMaterial
            color="#080808"
            emissive={col(tokens.primary)}
            emissiveIntensity={1.9}
            roughness={0.5}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ---- Light shafts ---------------------------------------------------------- */

// Vertical alpha falloff: full strength at the cone's apex, dissolving to
// nothing before the base — without it the additive cone stamps a hard
// bright disc on the floor and reads as solid geometry, not light.
let shaftAlphaTex = null;
function getShaftAlphaTex() {
  if (shaftAlphaTex) return shaftAlphaTex;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 128); // canvas top = cone top
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.55, "#5a5a5a");
  grad.addColorStop(1, "#000000");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 128);
  shaftAlphaTex = new THREE.CanvasTexture(c);
  return shaftAlphaTex;
}

function Shaft({ position, rotation, args, color, opacity, scale }) {
  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      <coneGeometry args={[...args, 20, 1, true]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        alphaMap={getShaftAlphaTex()}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ---- Main ------------------------------------------------------------------ */

const CONFIG = {
  "sci-fi": { rib: "panel", cornice: true, inlayGlow: true },
  fantasy: { rib: "pilaster", cornice: true, inlayGlow: false },
  "horror-gothic": { rib: "timber", cornice: false, inlayGlow: false },
  "noir-mystery": { rib: "flat", cornice: true, inlayGlow: false },
  nature: { rib: "trunk", cornice: false, inlayGlow: false },
  cyberpunk: { rib: "pipe", cornice: false, inlayGlow: true },
};

export function Architecture({ family, tokens, shell, layout }) {
  const cfg = CONFIG[family] || CONFIG["sci-fi"];
  const ribs = useMemo(() => ribPositions(layout), [layout]);
  const ribBase = useMemo(() => {
    switch (family) {
      case "horror-gothic":
        return scaled(col(tokens.border), 0.5);
      case "nature":
        return scaled(col(tokens.border), 0.75);
      default:
        return col(tokens.border);
    }
  }, [family, tokens]);
  const bandColor = useMemo(() => shell.wall.clone().multiplyScalar(0.72), [shell]);

  return (
    <group>
      {ribs.map((r) => (
        <group key={r.key} position={r.position} rotation={[0, r.rotY, 0]}>
          <Rib variant={cfg.rib} tokens={tokens} base={ribBase} />
        </group>
      ))}

      <Wainscot color={bandColor} />
      {cfg.cornice && <Cornice color={bandColor} />}
      <FloorInlay tokens={tokens} glow={cfg.inlayGlow} trim={bandColor} />

      {family === "sci-fi" && (
        <>
          <CeilingRing tokens={tokens} />
          <Shaft
            position={[0, 2.5, 0]}
            args={[2.1, 4.8]}
            color={col(tokens.primary)}
            opacity={0.06}
          />
        </>
      )}
      {family === "fantasy" && <Chandelier tokens={tokens} base={ribBase} />}
      {family === "horror-gothic" && <SwingingLantern base={ribBase} />}
      {family === "noir-mystery" && (
        <>
          <CeilingFan base={ribBase} />
          {/* the shaft falling from the venetian window */}
          <Shaft
            position={[-5.4, 1.55, -2]}
            rotation={[0, 0, 1.0]}
            args={[1.25, 5.6]}
            scale={[1, 1, 0.55]}
            color="#f2ead6"
            opacity={0.07}
          />
        </>
      )}
      {family === "nature" && (
        <>
          <CanopyRing tokens={tokens} />
          <Shaft
            position={[0, 2.35, 0]}
            args={[1.9, 4.7]}
            color={col(tokens.accent)}
            opacity={0.035}
          />
        </>
      )}
      {family === "cyberpunk" && <HoloRing tokens={tokens} />}
    </group>
  );
}
