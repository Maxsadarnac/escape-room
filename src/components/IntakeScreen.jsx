import { useEffect, useMemo, useRef, useState } from "react";
import "../intake.css";

/* The intake is a conversation with the Gamemaster: describe a room, pick a
   seal (difficulty), then watch the build ledger unseal the door. The
   Gamemaster's lines are scripted staging — all real progress in the ledger
   comes from the backend's stream events. */

const SEALS = [
  { id: "easy", label: "Easy", pips: "▪", blurb: "Three gentle locks. Hints come easy." },
  { id: "medium", label: "Medium", pips: "▪▪", blurb: "Four or five interlocking puzzles." },
  { id: "hard", label: "Hard", pips: "▪▪▪", blurb: "Five, maybe six locks. Thin mercy." },
];

const EXTRA_ACKS = ["Woven in.", "The picture sharpens.", "Good — more texture."];

const STAGES = [
  { id: "brief", label: "Reading your brief" },
  { id: "story", label: "Writing the story" },
  { id: "scene", label: "Painting the scene" },
  { id: "puzzles", label: "Setting the puzzles" },
  { id: "check", label: "Inspecting every lock" },
  { id: "build", label: "Cutting the keys" },
];

const RESET_ON_RETRY = ["story", "scene", "puzzles", "check"];

function deriveLedger(feed) {
  const state = Object.fromEntries(STAGES.map((s) => [s.id, "pending"]));
  const notes = [];
  let doorOpen = false;

  for (const event of feed) {
    if (event.type === "stage") {
      const idx = STAGES.findIndex((s) => s.id === event.stage);
      if (idx === -1) continue;
      for (let i = 0; i < idx; i++) state[STAGES[i].id] = "done";
      state[event.stage] = "active";
    } else if (event.type === "retry") {
      notes.push({
        key: `retry-${event.attempt}`,
        text:
          event.category === "SCHEMA"
            ? `The blueprint came back smudged — redrawing it (attempt ${event.attempt + 1} of ${event.max})`
            : `A puzzle failed inspection — rewriting it (attempt ${event.attempt + 1} of ${event.max})`,
      });
      for (const id of RESET_ON_RETRY) state[id] = "pending";
    } else if (event.type === "room") {
      for (const s of STAGES) state[s.id] = "done";
      doorOpen = true;
    }
  }

  const doneCount = STAGES.filter((s) => state[s.id] === "done").length;
  return { state, notes, doorOpen, progress: doorOpen ? 1 : doneCount / STAGES.length };
}

const STAGE_GLYPH = { pending: "·", active: "◇", done: "✓" };

let nextMsgId = 0;
const msg = (role, text, extra = {}) => ({ id: `m${nextMsgId++}`, role, text, ...extra });

export default function IntakeScreen({ onGenerate, onRetry, feed, genState, genError }) {
  const [messages, setMessages] = useState(() => [
    msg("guide", "You've found the workshop.", { delay: 150 }),
    msg("guide", "Describe the room you're imagining — a place, a mood, a story. I'll build the rest.", {
      delay: 650,
    }),
  ]);
  const [phase, setPhase] = useState("idea"); // idea | difficulty | building | ready | failed
  const [ideas, setIdeas] = useState([]);
  const [draft, setDraft] = useState("");
  const [seal, setSeal] = useState(null);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const prevGenState = useRef(genState);

  const ledger = useMemo(() => deriveLedger(feed), [feed]);
  const composerLocked = phase === "building" || phase === "ready";

  const push = (...newMessages) => setMessages((prev) => [...prev, ...newMessages]);

  // Stage-direct the Gamemaster's reactions to generation outcomes.
  useEffect(() => {
    if (prevGenState.current === genState) return;
    prevGenState.current = genState;
    if (genState === "ready") {
      setPhase("ready");
      push(msg("guide", "It's ready. Mind the threshold."));
    } else if (genState === "failed") {
      setPhase("failed");
      push(msg("guide", genError || "The build broke at the final lock.", { failed: true }));
    } else if (genState === "building") {
      setPhase("building");
    }
  }, [genState, genError]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, feed, genState]);

  const autosize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const send = () => {
    const text = draft.trim();
    if (!text || composerLocked) return;
    setDraft("");
    requestAnimationFrame(autosize);
    setIdeas((prev) => [...prev, text]);

    // The Gamemaster replies a considered beat after your note lands.
    if (phase === "idea") {
      push(
        msg("user", text),
        msg("guide", "Noted — I can see the walls already. How unforgiving should this room be?", {
          seals: true,
          delay: 420,
        })
      );
      setPhase("difficulty");
    } else if (phase === "difficulty") {
      push(
        msg("user", text),
        msg("guide", EXTRA_ACKS[(ideas.length - 1) % EXTRA_ACKS.length], { delay: 420 })
      );
    } else if (phase === "failed") {
      push(
        msg("user", text),
        msg("guide", "Adjusted. Pick a seal and I'll rebuild.", { seals: true, delay: 420 })
      );
      setPhase("difficulty");
    }
  };

  const pickSeal = (choice) => {
    if (phase !== "difficulty") return;
    setSeal(choice);
    push(msg("user", choice.label));
    onGenerate([...ideas].join(". "), choice.id);
  };

  const retry = () => {
    push(msg("user", "Run it again."));
    onRetry();
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const placeholder = {
    idea: "Describe the room you're imagining…",
    difficulty: "Add more detail, or pick a seal above…",
    building: "The gamemaster is at work…",
    ready: "Opening…",
    failed: "Adjust the idea, or run it again…",
  }[phase];

  // The door above the conversation: idle seam -> light rising with real
  // build progress -> leaves parting. Status the ledger announces (aria-live)
  // is mirrored here visually, so the whole block stays aria-hidden.
  const doorState =
    genState === "ready"
      ? "open"
      : genState === "failed"
        ? "halted"
        : genState === "building"
          ? "building"
          : "idle";
  const plaque = {
    idle: "nothing behind this door — yet",
    building: "work in progress",
    open: "open",
    halted: "build halted",
  }[doorState];

  return (
    <div className="intake">
      {genState === "ready" && <div className="door-flash" aria-hidden="true" />}

      <header className="intake-masthead">
        <span className="masthead-mark">◆ ROOMCRAFT</span>
        <span className="masthead-duty">gamemaster on duty</span>
      </header>
      <h1 className="sr-only">Roomcraft — describe your escape room</h1>

      <div className="intake-column">
        <div
          className={`threshold threshold--${doorState}`}
          style={{ "--door-progress": ledger.progress }}
          aria-hidden="true"
        >
          <div className="door">
            <div className="door-lintel">
              <span className="door-keystone">◆</span>
            </div>
            <div className="door-leaves">
              <i className="door-leaf" />
              <i className="door-seam" />
              <i className="door-leaf" />
            </div>
          </div>
          <div className="door-spill" />
          <p className="door-plaque">{plaque}</p>
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-messages" aria-live="polite">
            {messages.map((m) =>
              m.role === "guide" ? (
                <div
                  key={m.id}
                  className={`msg msg-guide${m.failed ? " msg-guide--failed" : ""}`}
                  style={m.delay ? { animationDelay: `${m.delay}ms` } : undefined}
                >
                  <span className="guide-glyph" aria-hidden="true">
                    ◆
                  </span>
                  <div className="guide-body">
                    <p>{m.text}</p>
                    {m.seals && (
                      <div className="seal-row" role="group" aria-label="Choose a difficulty">
                        {SEALS.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className={`seal${seal?.id === s.id ? " is-picked" : ""}`}
                            disabled={phase !== "difficulty"}
                            onClick={() => pickSeal(s)}
                          >
                            <span className="seal-head">
                              <b>{s.pips}</b> {s.label}
                            </span>
                            <span className="seal-blurb">{s.blurb}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="msg msg-user">
                  <p>{m.text}</p>
                </div>
              )
            )}

            {phase === "failed" && (
              <div className="retry-row">
                <button type="button" className="seal seal--retry" onClick={retry} autoFocus>
                  <span className="seal-head">
                    <b>↻</b> Run it again
                  </span>
                  <span className="seal-blurb">Same brief, same seal, fresh build.</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="composer">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder={placeholder}
            disabled={composerLocked}
            onChange={(e) => {
              setDraft(e.target.value);
              autosize();
            }}
            onKeyDown={onKeyDown}
            autoFocus
          />
          <button
            type="button"
            className="composer-send"
            onClick={send}
            disabled={composerLocked || draft.trim().length === 0}
          >
            Send
          </button>
        </div>
        <p className="composer-hint">↵ to send · shift+↵ for a new line</p>

        {genState !== "idle" && (
          <section className="ledger" aria-live="polite" aria-label="Build progress">
            <span className="ledger-seam" aria-hidden="true">
              <i style={{ height: `${ledger.progress * 100}%` }} />
            </span>
            <header className="ledger-head">
              <span>Build ledger</span>
              <span>{seal ? seal.label : ""}</span>
            </header>
            <ul className="ledger-stages">
              {STAGES.map((s) => (
                <li key={s.id} className={`ledger-line is-${ledger.state[s.id]}`}>
                  <span className="ledger-glyph" aria-hidden="true">
                    {STAGE_GLYPH[ledger.state[s.id]]}
                  </span>
                  {s.label}
                </li>
              ))}
            </ul>
            {ledger.notes.map((n) => (
              <p key={n.key} className="ledger-note">
                {n.text}
              </p>
            ))}
            {ledger.doorOpen && <p className="ledger-door">The door is open.</p>}
            {genState === "failed" && <p className="ledger-halt">Build halted.</p>}
          </section>
        )}
      </div>
    </div>
  );
}
