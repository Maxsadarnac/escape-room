import { useEffect, useState } from "react";
import { generateRoom } from "./api";
import IntakeScreen from "./components/IntakeScreen";
import RoomScreen from "./components/RoomScreen";
import CompletionScreen from "./components/CompletionScreen";
import "./App.css";

function App() {
  const [screen, setScreen] = useState("intake");
  const [room, setRoom] = useState(null);
  const [solved, setSolved] = useState(new Set());
  const [hintsRevealed, setHintsRevealed] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRequest, setLastRequest] = useState(null);

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

  const runGenerate = async (theme, difficulty) => {
    setLoading(true);
    setError(null);
    setLastRequest({ theme, difficulty });
    try {
      const data = await generateRoom(theme, difficulty);
      setRoom(data);
      setSolved(new Set());
      setHintsRevealed({});
      setScreen("room");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
    setError(null);
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
      loading={loading}
      error={error}
      onRetry={handleRetry}
    />
  );
}

export default App;
