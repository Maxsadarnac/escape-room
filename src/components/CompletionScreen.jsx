export default function CompletionScreen({ outro, onRestart }) {
  return (
    <div className="screen completion-screen">
      <div className="completion-card">
        <h1>You Escaped</h1>
        <p className="completion-outro">{outro}</p>
        <button type="button" className="btn btn-primary" onClick={onRestart}>
          Generate Another Room
        </button>
      </div>
    </div>
  );
}
