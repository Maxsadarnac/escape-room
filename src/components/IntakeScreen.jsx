import { useState } from "react";
import DifficultyToggle from "./DifficultyToggle";

export default function IntakeScreen({ onGenerate, loading, error, onRetry }) {
  const [theme, setTheme] = useState("");
  const [difficulty, setDifficulty] = useState("medium");

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = theme.trim();
    if (!trimmed || loading) return;
    onGenerate(trimmed, difficulty);
  };

  return (
    <div className="screen intake-screen">
      <div className="intake-card">
        <h1>Escape Room Generator</h1>
        <p className="intake-subtitle">Describe a theme. Get a fully playable room.</p>

        <form onSubmit={handleSubmit} className="intake-form">
          <textarea
            className="theme-input"
            placeholder="Describe your escape room idea..."
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            disabled={loading}
            rows={3}
          />

          <div className="intake-controls">
            <DifficultyToggle value={difficulty} onChange={setDifficulty} disabled={loading} />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || theme.trim().length === 0}
            >
              {loading ? "Generating..." : "Generate Room"}
            </button>
          </div>
        </form>

        {loading && (
          <p className="loading-text" aria-live="polite">
            Generating your room...
          </p>
        )}

        {error && !loading && (
          <div className="error-box" role="alert">
            <p>{error}</p>
            <button type="button" className="btn btn-secondary" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
