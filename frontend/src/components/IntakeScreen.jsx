import { useEffect, useMemo, useRef, useState } from "react";
import { fetchRoomByCode } from "../api";
import "../intake.css";

/* Roomcraft Landing — the studio console you hand a brief to. Visual design
   ported from the Claude Design mock (Roomcraft Landing.dc.html); wired
   here to the real pipeline: the brief posts to /generate-room/stream, the
   difficulty toggle picks easy/medium/hard, and the ledger below reflects
   real backend stage events (see api.js + server.js), not a timer.

   Two things the mock only stubbed are made genuinely functional here
   rather than left as decoration:
     - the World selector nudges the theme text sent to the model (it
       doesn't override the brief — an empty/"any world" pick sends the
       brief untouched, so the model's own classification stays in charge)
     - the room code is real and server-backed: every generated room is
       persisted by the backend (lib/roomStore) and returns with
       room.shareCode; entering a code here fetches the exact stored room
       from GET /rooms/:code, on any device that can reach the server. The
       localStorage gallery remains as this browser's history and as a
       fallback for legacy local-only "RC-" codes minted before the store
       existed. */

const WORLDS = [
  { id: "auto", label: "ANY WORLD", hint: null },
  { id: "scifi", label: "SCI-FI", hint: "a science-fiction spaceship setting" },
  { id: "fantasy", label: "FANTASY", hint: "a fantasy castle-and-wizardry setting" },
  { id: "horror", label: "HORROR", hint: "a horror haunted setting" },
  { id: "noir", label: "NOIR", hint: "a noir detective mystery setting" },
  { id: "nature", label: "NATURE", hint: "a nature forest setting" },
  { id: "cyberpunk", label: "CYBERPUNK", hint: "a cyberpunk neon setting" },
];

const DIFFICULTIES = [
  { id: "easy", numeral: "I", label: "EASY", hint: "3 PUZZLES · GENTLE LOCKS" },
  { id: "medium", numeral: "II", label: "MEDIUM", hint: "4–5 PUZZLES · LAYERED LOCKS" },
  { id: "hard", numeral: "III", label: "HARD", hint: "5–6 PUZZLES · NO MERCY" },
];

const SEEDS = [
  "A derelict submarine, thirty minutes of air",
  "The magician's apartment, sealed since 1926",
  "A library where one book is a door",
];

// Mirrors the backend's real stream stages (server.js STAGE_MARKERS + the
// brief/check/build beats it emits around them) — these labels are the
// only thing invented here; the progress they report is genuine.
const STAGES = [
  { id: "brief", label: "Reading your brief" },
  { id: "story", label: "Writing the story" },
  { id: "scene", label: "Painting the scene" },
  { id: "puzzles", label: "Designing the puzzles" },
  { id: "check", label: "Inspecting every lock" },
  { id: "build", label: "Cutting the keys" },
];

const RESET_ON_RETRY = ["story", "scene", "puzzles", "check"];
const GALLERY_KEY = "roomcraft_gallery";
const GALLERY_CAP = 24;

function formatElapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `RC-${s}`;
}

function loadGallery() {
  try {
    const saved = JSON.parse(localStorage.getItem(GALLERY_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/** Replays the stream feed into per-stage state + retry notes + elapsed
    timestamps, exactly like the real pipeline reported it — no timers. */
function buildLedger(feed, arrivals, startTime) {
  const state = Object.fromEntries(STAGES.map((s) => [s.id, "pending"]));
  const doneAt = {};
  const notes = [];
  let doorOpen = false;

  feed.forEach((event, i) => {
    const t = arrivals[i];
    if (event.type === "stage") {
      const idx = STAGES.findIndex((s) => s.id === event.stage);
      if (idx === -1) return;
      for (let j = 0; j < idx; j++) {
        if (state[STAGES[j].id] !== "done") {
          state[STAGES[j].id] = "done";
          doneAt[STAGES[j].id] = t;
        }
      }
      state[event.stage] = "active";
    } else if (event.type === "retry") {
      notes.push({
        key: `retry-${event.attempt}`,
        text:
          event.category === "SCHEMA"
            ? `The blueprint came back smudged — redrawing it (attempt ${event.attempt + 1} of ${event.max})`
            : `A puzzle failed inspection — rewriting it (attempt ${event.attempt + 1} of ${event.max})`,
      });
      for (const id of RESET_ON_RETRY) {
        state[id] = "pending";
        delete doneAt[id];
      }
    } else if (event.type === "room") {
      for (const s of STAGES) {
        if (state[s.id] !== "done") {
          state[s.id] = "done";
          doneAt[s.id] = t;
        }
      }
      doorOpen = true;
    }
  });

  const lines = STAGES.filter((s) => state[s.id] !== "pending").map((s) => ({
    id: s.id,
    active: state[s.id] === "active",
    text: s.label + (state[s.id] === "active" ? "…" : ""),
    stamp:
      state[s.id] === "done" && startTime != null && doneAt[s.id] != null
        ? formatElapsed(doneAt[s.id] - startTime)
        : "",
  }));

  const doneCount = STAGES.filter((s) => state[s.id] === "done").length;
  return { lines, notes, doorOpen, progress: doorOpen ? 1 : doneCount / STAGES.length };
}

export default function IntakeScreen({ onGenerate, onRetry, onRestart, onEnterRoom, feed, genState, genError, room }) {
  const [brief, setBrief] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [world, setWorld] = useState("auto");
  const [worldMenuOpen, setWorldMenuOpen] = useState(false);

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [gallery, setGallery] = useState(loadGallery);
  const [joinCode, setJoinCode] = useState("");
  const [joinMessage, setJoinMessage] = useState("");
  const [joinOk, setJoinOk] = useState(false);

  const [roomCode, setRoomCode] = useState("");
  const [copyLabel, setCopyLabel] = useState("COPY");

  const textareaRef = useRef(null);
  const worldWrapRef = useRef(null);
  const savedForRef = useRef(null); // dedupes gallery save per generation

  const generating = genState === "building";
  const composerLocked = generating || genState === "ready";

  // ---- Real elapsed-time tracking for the ledger, driven off actual
  // stream-event arrival, not a fabricated timer.
  const arrivalsRef = useRef([]);
  const startRef = useRef(null);
  const prevGenStateRef = useRef(genState);
  useEffect(() => {
    while (arrivalsRef.current.length < feed.length) arrivalsRef.current.push(performance.now());
  }, [feed]);
  useEffect(() => {
    if (prevGenStateRef.current !== "building" && genState === "building") {
      startRef.current = performance.now();
      arrivalsRef.current = [];
    }
    prevGenStateRef.current = genState;
  }, [genState]);

  const ledger = useMemo(
    () => buildLedger(feed, arrivalsRef.current, startRef.current),
    // feed identity change is the real trigger; arrivals/start are refs kept in step with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed]
  );

  // Close the World dropdown on outside click / Escape.
  useEffect(() => {
    if (!worldMenuOpen) return;
    const onDocClick = (e) => {
      if (worldWrapRef.current && !worldWrapRef.current.contains(e.target)) setWorldMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setWorldMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [worldMenuOpen]);

  // On a fresh success, record the room in the local gallery (once per
  // generation). The code is the server's share code — minting locally is
  // only a fallback for the rare case persistence failed server-side.
  useEffect(() => {
    if (genState !== "ready" || !room || savedForRef.current === room) return;
    savedForRef.current = room;
    const code = room.shareCode || generateCode();
    const worldMeta = WORLDS.find((w) => w.id === world);
    const entry = {
      code,
      theme: room.visualFamily || worldMeta?.label || "ROOM",
      difficulty: difficulty.toUpperCase(),
      brief: brief.trim() || "(untitled brief)",
      ts: Date.now(),
      room,
    };
    setGallery((prev) => {
      const next = [entry, ...prev].slice(0, GALLERY_CAP);
      try {
        localStorage.setItem(GALLERY_KEY, JSON.stringify(next));
      } catch {
        // localStorage full or unavailable (private browsing) — keep it
        // in memory for this session, just skip persisting.
      }
      return next;
    });
    setRoomCode(code);
    setCopyLabel("COPY");
  }, [genState, room, world, difficulty, brief]);

  const autosize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  const composedTheme = () => {
    const base = brief.trim();
    const w = WORLDS.find((w) => w.id === world);
    return w?.hint ? `${base} — envisioned as ${w.hint}.` : base;
  };

  const craft = () => {
    if (!brief.trim() || composerLocked) return;
    onGenerate(composedTheme(), difficulty);
  };

  const onTextareaKey = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      craft();
    }
  };

  const pickSeed = (text) => {
    if (composerLocked) return;
    setBrief(`${text}.`);
    requestAnimationFrame(autosize);
    textareaRef.current?.focus();
  };

  const startOver = () => {
    savedForRef.current = null;
    setRoomCode("");
    onRestart();
  };

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code).catch(() => {});
  };

  const doJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setJoinMessage("LOOKING UP…");
    setJoinOk(false);
    try {
      const record = await fetchRoomByCode(code);
      const family = (record.room.visualFamily || record.theme || "ROOM").toUpperCase();
      setJoinMessage(`FOUND · ${family} · ${(record.difficulty || "").toUpperCase()}`);
      setJoinOk(true);
      setTimeout(() => onEnterRoom(record.room), 350);
    } catch (err) {
      // Legacy local-only codes (minted before the server store existed)
      // still resolve from this browser's gallery.
      const local = gallery.find((g) => g.code === code);
      if (local?.room) {
        setJoinMessage(`FOUND IN THIS BROWSER · ${local.theme} · ${local.difficulty}`);
        setJoinOk(true);
        setTimeout(() => onEnterRoom(local.room), 350);
      } else {
        setJoinMessage(err.notFound ? "NO ROOM WITH THAT CODE" : "ARCHIVE UNREACHABLE — TRY AGAIN");
        setJoinOk(false);
      }
    }
  };

  const worldMeta = WORLDS.find((w) => w.id === world);

  return (
    <div className="rc-landing">
      <div className="rc-glow" aria-hidden="true" />

      <header className="rc-header">
        <div className="rc-brandmark">
          <div className="rc-brandmark-ring">
            <i />
          </div>
          <div className="rc-wordmark">ROOMCRAFT</div>
        </div>
        <nav className="rc-nav">
          <button
            type="button"
            className={`rc-btn-reset rc-gallery-toggle${galleryOpen ? " is-open" : ""}`}
            onClick={() => setGalleryOpen((v) => !v)}
          >
            GALLERY <span>({gallery.length})</span>
          </button>
          <div className="rc-nav-divider" />
          <div className="rc-join">
            <input
              className="rc-join-input"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value);
                setJoinMessage("");
              }}
              onKeyDown={(e) => e.key === "Enter" && doJoin()}
              placeholder="HAVE A CODE?"
              aria-label="Room code"
            />
            <button type="button" className="rc-btn-reset rc-join-btn" onClick={doJoin}>
              ENTER
            </button>
            {joinMessage && (
              <div className={`rc-join-msg${joinOk ? " is-ok" : ""}`} role="status">
                {joinMessage}
              </div>
            )}
          </div>
        </nav>
      </header>

      {galleryOpen && (
        <div className="rc-gallery-panel">
          <div className="rc-gallery-title">YOUR ROOMS</div>
          {gallery.length === 0 ? (
            <div className="rc-gallery-empty">No rooms crafted yet — generate one below and it will appear here.</div>
          ) : (
            gallery.map((g) => (
              <div className="rc-gallery-row" key={g.code}>
                <div className="rc-gallery-code">{g.code}</div>
                <div className="rc-gallery-theme">{g.theme}</div>
                <div className="rc-gallery-diff">{g.difficulty}</div>
                <div className="rc-gallery-brief">{g.brief}</div>
                <button type="button" className="rc-gallery-copy" onClick={() => copyCode(g.code)}>
                  COPY CODE
                </button>
              </div>
            ))
          )}
          <div className="rc-gallery-hint">
            Codes are stored on the server — share one and any device that can reach it can replay
            the exact room. (Older RC- codes remain local to this browser.)
          </div>
        </div>
      )}

      <main className="rc-main">
        <h1 className="sr-only">Roomcraft — describe your escape room</h1>
        <div className="rc-hero">
          <div className="rc-eyebrow">AI ESCAPE ROOM GENERATOR&nbsp;&nbsp;·&nbsp;&nbsp;COMMISSION Nº 001</div>
          <p className="rc-title">
            Describe it. <span className="rc-title-accent">Escape it.</span>
          </p>
          <p className="rc-subtitle">
            Hand the game master a brief. A playable room — puzzles, locks, and one way out — is drafted while you
            watch.
          </p>
        </div>

        <div className="rc-console">
          <div className="rc-console-head">
            <div className="rc-console-label">YOUR BRIEF</div>
            <div className="rc-console-controls">
              <div className="rc-world" ref={worldWrapRef}>
                <button
                  type="button"
                  className={`rc-world-btn${worldMenuOpen ? " is-open" : ""}`}
                  onClick={() => setWorldMenuOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={worldMenuOpen}
                >
                  <span className="rc-world-btn-tag">WORLD</span>
                  <span className="rc-world-btn-val">{worldMeta.label}</span>
                  <span className="rc-world-btn-caret">▾</span>
                </button>
                {worldMenuOpen && (
                  <div className="rc-world-menu" role="listbox">
                    {WORLDS.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        role="option"
                        aria-selected={w.id === world}
                        className={`rc-world-option${w.id === world ? " is-active" : ""}`}
                        onClick={() => {
                          setWorld(w.id);
                          setWorldMenuOpen(false);
                        }}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="rc-diff-toggle" role="group" aria-label="Difficulty">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`rc-diff-btn${d.id === difficulty ? " is-active" : ""}`}
                    onClick={() => setDifficulty(d.id)}
                  >
                    <span className="rc-diff-numeral">{d.numeral}</span>
                    <span className="rc-diff-label">{d.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rc-brief-field">
            <textarea
              ref={textareaRef}
              className="rc-textarea"
              value={brief}
              onChange={(e) => {
                setBrief(e.target.value);
                autosize();
              }}
              onKeyDown={onTextareaKey}
              rows={3}
              disabled={composerLocked}
              placeholder="A candlelit observatory where every constellation has been quietly rearranged — and the astronomer knew why…"
            />
          </div>

          <div className="rc-seeds">
            {SEEDS.map((s) => (
              <button key={s} type="button" className="rc-seed" disabled={composerLocked} onClick={() => pickSeed(s)}>
                {s}
              </button>
            ))}
          </div>

          <div className="rc-console-foot">
            <div className="rc-hint">
              {generating
                ? "THE GAME MASTER IS AT WORK"
                : `${DIFFICULTIES.find((d) => d.id === difficulty).hint}  ·  ⌘⏎ TO CRAFT`}
            </div>
            <button type="button" className="rc-craft-btn" onClick={craft} disabled={composerLocked || !brief.trim()}>
              {generating ? "CRAFTING…" : "CRAFT THE ROOM →"}
            </button>
          </div>
        </div>

        {genState !== "idle" && (
          <div className="rc-ledger-wrap" aria-live="polite" aria-label="Build progress">
            <div className="rc-ledger-title">THE LEDGER — {difficulty.toUpperCase()} COMMISSION</div>
            {ledger.lines.map((line) => (
              <div key={line.id} className={`rc-ledger-line${line.active ? " is-active" : ""}`}>
                <span className="rc-ledger-icon">{line.active ? "◌" : "✓"}</span>
                <span className="rc-ledger-text">{line.text}</span>
                <span className="rc-ledger-stamp">{line.stamp}</span>
              </div>
            ))}
            {ledger.notes.map((n) => (
              <div key={n.key} className="rc-ledger-note">
                {n.text}
              </div>
            ))}

            {genState === "failed" && (
              <div className="rc-ledger-error">
                <div className="rc-ledger-error-text">{genError || "The build broke at the final lock."}</div>
                <div className="rc-ledger-error-actions">
                  <button type="button" className="is-primary" onClick={onRetry}>
                    RUN IT AGAIN
                  </button>
                  <button type="button" onClick={startOver}>
                    START OVER
                  </button>
                </div>
              </div>
            )}

            {genState === "ready" && (
              <div className="rc-door-ready">
                <div>
                  <div className="rc-door-ready-title">The door is ready.</div>
                  <div className="rc-door-ready-code">
                    <span className="rc-door-ready-code-label">ROOM CODE</span>
                    <span className="rc-door-ready-code-val">{roomCode}</span>
                    <button
                      type="button"
                      className="rc-copy-btn"
                      onClick={() => {
                        copyCode(roomCode);
                        setCopyLabel("COPIED");
                        setTimeout(() => setCopyLabel("COPY"), 1400);
                      }}
                    >
                      {copyLabel}
                    </button>
                  </div>
                </div>
                <div className="rc-door-ready-actions">
                  <button type="button" className="rc-startover-btn" onClick={startOver}>
                    START OVER
                  </button>
                  <button type="button" className="rc-enter-btn" onClick={() => onEnterRoom(room)}>
                    ENTER THE ROOM →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="rc-footer">
        <div className="rc-footer-steps">
          <div>
            <span>01</span>&nbsp;&nbsp;DESCRIBE
          </div>
          <div>
            <span>02</span>&nbsp;&nbsp;GENERATE
          </div>
          <div>
            <span>03</span>&nbsp;&nbsp;ESCAPE
          </div>
        </div>
        <div>ROOMCRAFT STUDIO · MMXXVI</div>
      </footer>
    </div>
  );
}
