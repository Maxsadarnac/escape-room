import { useState } from "react";

const TYPE_ICONS = {
  cipher: "🔐",
  riddle: "📜",
  pattern: "🔷",
  logic: "🧮",
  observation: "👁️",
  arrangement: "🗝️",
  meta: "🔏",
};

export default function PuzzleCard({ puzzle, label, locked, solved, hintsRevealed, onSolve, onRevealHint }) {
  const [answerInput, setAnswerInput] = useState("");
  const [feedback, setFeedback] = useState(null);

  const icon = TYPE_ICONS[puzzle.type] || "🧩";
  const headerLabel = label || puzzle.id;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (locked || solved) return;

    const normalizedGuess = answerInput.trim().toLowerCase();
    const normalizedAnswer = puzzle.answer.trim().toLowerCase();

    if (normalizedGuess === normalizedAnswer) {
      setFeedback(null);
      onSolve(puzzle.id);
    } else {
      setFeedback("Not quite — try again.");
      setAnswerInput("");
    }
  };

  const allHintsShown = hintsRevealed >= puzzle.hints.length;

  if (locked) {
    return (
      <div className="puzzle-card is-locked">
        <div className="puzzle-header">
          <span className="puzzle-icon">🔒</span>
          <h3>{headerLabel}</h3>
        </div>
        <p className="puzzle-locked-note">Locked — solve the required puzzles first.</p>
      </div>
    );
  }

  if (solved) {
    return (
      <div className="puzzle-card is-solved">
        <div className="puzzle-header">
          <span className="puzzle-icon">✅</span>
          <h3>{headerLabel}</h3>
        </div>
        {/* Meta-lock digit reveals: the finale needs these to stay readable
            after the solve, so the player can come back and collect them. */}
        {puzzle.reveal && <p className="puzzle-reveal">{puzzle.reveal}</p>}
      </div>
    );
  }

  return (
    <div className="puzzle-card is-active">
      <div className="puzzle-header">
        <span className="puzzle-icon">{icon}</span>
        <h3>{headerLabel}</h3>
      </div>

      <p className="puzzle-prompt">{puzzle.prompt}</p>

      <form onSubmit={handleSubmit} className="answer-form">
        <input
          type="text"
          value={answerInput}
          onChange={(e) => setAnswerInput(e.target.value)}
          placeholder="Your answer..."
          className="answer-input"
        />
        <button type="submit" className="btn btn-primary btn-small">
          Submit
        </button>
      </form>

      {feedback && <p className="answer-feedback">{feedback}</p>}

      <div className="hints-section">
        {Array.from({ length: hintsRevealed }).map((_, i) => (
          <p key={i} className="hint-text">
            💡 {puzzle.hints[i]}
          </p>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => onRevealHint(puzzle.id)}
          disabled={allHintsShown}
        >
          {allHintsShown ? "No more hints" : "Reveal a hint"}
        </button>
      </div>
    </div>
  );
}
