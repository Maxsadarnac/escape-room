import { useEffect, useRef, useState } from "react";
import { generateRoomStream } from "./api";
import IntakeScreen from "./components/IntakeScreen";
import RoomScreen from "./components/RoomScreen";
import CompletionScreen from "./components/CompletionScreen";
import "./App.css";

function App() {
  const [screen, setScreen] = useState("intake");
  const [room, setRoom] = useState(null);
  const [solved, setSolved] = useState(new Set());
  const [hintsRevealed, setHintsRevealed] = useState({});
  const [lastRequest, setLastRequest] = useState(null);

  // Generation stream state, consumed by the intake screen's build ledger.
  const [feed, setFeed] = useState([]);
  const [genState, setGenState] = useState("idle"); // idle | building | ready | failed
  const [genError, setGenError] = useState(null);
  const revealTimer = useRef(null);

  useEffect(() => {
    if (screen === "room" && room && solved.size === room.puzzles.length) {
      // Small delay so the final solve's flourish is visible in the 3D room
      // before the completion screen takes over.
      const t = setTimeout(() => setScreen("complete"), 1800);
      return () => clearTimeout(t);
    }
  }, [solved, room, screen]);

  // Dev-only: load a fixture room via ?devRoom=<name> (files in
  // public/dev-rooms/) so each visual family can be exercised without the
  // backend. Stripped from production behavior by the DEV guard.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const name = new URLSearchParams(window.location.search).get("devRoom");
    if (!name) return;
    fetch(`/dev-rooms/${encodeURIComponent(name)}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setRoom(data);
          setSolved(new Set());
          setHintsRevealed({});
          setScreen("room");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => clearTimeout(revealTimer.current), []);

  const runGenerate = async (theme, difficulty) => {
    setGenState("building");
    setGenError(null);
    setFeed([]);
    setLastRequest({ theme, difficulty });
    try {
      const data = await generateRoomStream(theme, difficulty, (event) => {
        setFeed((prev) => [...prev, event]);
      });
      setRoom(data);
      setSolved(new Set());
      setHintsRevealed({});
      setGenState("ready");
      // Hold on the intake a beat so "The door is open." lands before the
      // room takes over.
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      revealTimer.current = setTimeout(() => setScreen("room"), reduced ? 500 : 1700);
    } catch (err) {
      setGenError(err.message);
      setGenState("failed");
    }
  };

  const handleGenerate = (theme, difficulty) => {
    runGenerate(theme, difficulty);
  };

  const handleRetry = () => {
    if (lastRequest) {
      runGenerate(lastRequest.theme, lastRequest.difficulty);
    }
  };

  const handleSolve = (puzzleId) => {
    setSolved((prev) => {
      const next = new Set(prev);
      next.add(puzzleId);
      return next;
    });
  };

  const handleRevealHint = (puzzleId) => {
    setHintsRevealed((prev) => {
      const puzzle = room.puzzles.find((p) => p.id === puzzleId);
      const current = prev[puzzleId] || 0;
      if (!puzzle || current >= puzzle.hints.length) return prev;
      return { ...prev, [puzzleId]: current + 1 };
    });
  };

  const handleRestart = () => {
    setRoom(null);
    setSolved(new Set());
    setHintsRevealed({});
    setFeed([]);
    setGenState("idle");
    setGenError(null);
    setScreen("intake");
  };

  if (screen === "room" && room) {
    return (
      <RoomScreen
        room={room}
        solved={solved}
        hintsRevealed={hintsRevealed}
        onSolve={handleSolve}
        onRevealHint={handleRevealHint}
      />
    );
  }

  if (screen === "complete" && room) {
    return <CompletionScreen outro={room.story.outro} onRestart={handleRestart} />;
  }

  return (
    <IntakeScreen
      onGenerate={handleGenerate}
      onRetry={handleRetry}
      feed={feed}
      genState={genState}
      genError={genError}
    />
  );
}

export default App;
