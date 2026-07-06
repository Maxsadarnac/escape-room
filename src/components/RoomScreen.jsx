import { Component, Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import PuzzleCard from "./PuzzleCard";
import { layoutScene } from "../three/layoutRoom";
import { normalizeFamily, readFamilyTokens } from "../three/familyTokens";
import "../families.css";
import "../room3d.css";

// three.js + react-three-fiber live in their own chunk so the intake screen
// doesn't pay for them.
const Room3D = lazy(() => import("../three/RoomScene.jsx"));

function detectWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** If the 3D view throws for any reason, degrade to the 2D card list. */
class Room3DBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.warn("3D room view failed — falling back to 2D:", error);
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function RoomScreen({ room, solved, hintsRevealed, onSolve, onRevealHint }) {
  const family = normalizeFamily(room.visualFamily);
  const rootRef = useRef(null);

  const [tokens, setTokens] = useState(null);
  const [use2D, setUse2D] = useState(() => !detectWebGL());
  const [reducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [brief, setBrief] = useState(true);
  const [phase, setPhase] = useState("waiting"); // waiting -> intro -> live
  const [selection, setSelection] = useState(null); // { prop, wasSolved }
  const [hintSeen, setHintSeen] = useState(false);
  const closeBtnRef = useRef(null);

  const layout = useMemo(() => layoutScene(room), [room]);
  const labelByPuzzleId = useMemo(
    () =>
      Object.fromEntries(
        layout.filter((p) => p.interactive).map((p) => [p.puzzleId, p.label])
      ),
    [layout]
  );

  // Pull the family's CSS custom properties off the mounted element so the
  // 3D palette is literally the families.css palette.
  useLayoutEffect(() => {
    setTokens(readFamilyTokens(rootRef.current, family));
  }, [family]);

  const isLocked = (puzzle) => puzzle.requires.some((reqId) => !solved.has(reqId));

  const enterRoom = () => {
    setBrief(false);
    if (phase === "waiting") setPhase(reducedMotion ? "live" : "intro");
  };

  const handleSelect = (prop) => {
    setSelection({ prop, wasSolved: solved.has(prop.puzzleId) });
    setHintSeen(true);
  };

  const closeOverlay = () => setSelection(null);

  // Close the puzzle overlay shortly after a fresh solve so the player sees
  // the object transform in the room.
  useEffect(() => {
    if (selection && !selection.wasSolved && solved.has(selection.prop.puzzleId)) {
      const t = setTimeout(() => setSelection(null), 1100);
      return () => clearTimeout(t);
    }
  }, [selection, solved]);

  // Escape closes the puzzle overlay; focus lands on its close button.
  useEffect(() => {
    if (!selection) return;
    closeBtnRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection]);

  /* ---- 2D fallback (no WebGL, or the 3D view crashed) ---- */
  if (use2D) {
    return (
      <div className={`screen room-screen family-${family}`} data-family={family}>
        <div className="story-block">
          <p>{room.story.intro}</p>
        </div>
        <div className="puzzle-list">
          {room.puzzles.map((puzzle) => (
            <PuzzleCard
              key={puzzle.id}
              puzzle={puzzle}
              label={labelByPuzzleId[puzzle.id]}
              locked={isLocked(puzzle)}
              solved={solved.has(puzzle.id)}
              hintsRevealed={hintsRevealed[puzzle.id] || 0}
              onSolve={onSolve}
              onRevealHint={onRevealHint}
            />
          ))}
        </div>
      </div>
    );
  }

  const activePuzzle = selection
    ? room.puzzles.find((p) => p.id === selection.prop.puzzleId)
    : null;
  const activeLocked = activePuzzle ? isLocked(activePuzzle) : false;
  const unmetLabels = activeLocked
    ? activePuzzle.requires
        .filter((r) => !solved.has(r))
        .map((r) => labelByPuzzleId[r] || r.replace(/[_-]+/g, " "))
    : [];

  return (
    <div
      ref={rootRef}
      className={`screen room-screen room-screen--3d family-${family}`}
      data-family={family}
    >
      <div className="room3d-stage">
        {tokens && (
          <Room3DBoundary onFailure={() => setUse2D(true)}>
            <Suspense fallback={null}>
              <Room3D
                room={room}
                layout={layout}
                family={family}
                tokens={tokens}
                solved={solved}
                phase={phase}
                onIntroDone={() => setPhase("live")}
                onSelectObject={handleSelect}
                focusProp={selection ? selection.prop : null}
                reducedMotion={reducedMotion}
              />
            </Suspense>
          </Room3DBoundary>
        )}
      </div>

      {/* HUD */}
      <div className="room3d-hud">
        <div className="room3d-hud-top">
          <div className="room3d-hud-left">
            {room.theme && <span className="room3d-theme">{room.theme}</span>}
            {phase === "live" && !brief && (
              <button
                type="button"
                className="btn btn-ghost btn-small room3d-hud-btn"
                onClick={() => setBrief(true)}
              >
                Brief
              </button>
            )}
          </div>
          <div className="room3d-progress">
            {solved.size} / {room.puzzles.length} solved
          </div>
        </div>
        {phase === "intro" && (
          <button
            type="button"
            className="btn btn-ghost btn-small room3d-skip room3d-hud-btn"
            onClick={() => setPhase("live")}
          >
            Skip intro
          </button>
        )}
        {phase === "live" && !brief && !hintSeen && (
          <div className="room3d-hint">Drag to look around — click a lit object to inspect it</div>
        )}
      </div>

      {/* Story brief */}
      {brief && (
        <div className="room3d-overlay room3d-overlay--brief">
          <div className="room3d-brief">
            <div className="story-block">
              <p>{room.story.intro}</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={enterRoom} autoFocus>
              {phase === "waiting" ? "Enter the room" : "Return to the room"}
            </button>
          </div>
        </div>
      )}

      {/* Puzzle overlay */}
      {selection && activePuzzle && (
        <div
          className={`room3d-overlay${reducedMotion ? "" : " room3d-overlay--glide"}`}
          onClick={closeOverlay}
        >
          <div
            className="room3d-modal"
            role="dialog"
            aria-label={selection.prop.label}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="room3d-modal-head">
              <h2>{selection.prop.label}</h2>
              <button
                type="button"
                ref={closeBtnRef}
                className="room3d-close"
                aria-label="Close"
                onClick={closeOverlay}
              >
                ✕
              </button>
            </div>
            {activeLocked && unmetLabels.length > 0 && (
              <p className="room3d-requires">
                Sealed — first deal with: {unmetLabels.join(", ")}
              </p>
            )}
            <PuzzleCard
              puzzle={activePuzzle}
              label={selection.prop.label}
              locked={activeLocked}
              solved={solved.has(activePuzzle.id)}
              hintsRevealed={hintsRevealed[activePuzzle.id] || 0}
              onSolve={onSolve}
              onRevealHint={onRevealHint}
            />
          </div>
        </div>
      )}
    </div>
  );
}
