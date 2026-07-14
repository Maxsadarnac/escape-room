const API_BASE = "http://localhost:3001";

export async function generateRoom(theme, difficulty) {
  let response;
  try {
    response = await fetch(`${API_BASE}/generate-room`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme, difficulty }),
    });
  } catch {
    throw new Error(
      "Could not reach the room generator. Is the backend running on localhost:3001?"
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response.");
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(data.error || "Too many requests — wait a moment and try again.");
    }
    throw new Error(data.error || `Room generation failed (status ${response.status}).`);
  }

  return data;
}

/**
 * Streaming generation: consumes the backend's NDJSON progress feed and
 * reports every event through onEvent (stage / retry / room / error — pings
 * are swallowed here). Resolves with the finished room; throws with the
 * server's in-band error otherwise. Falls back to the plain endpoint when
 * the environment can't stream, synthesizing the minimal event pair so the
 * caller's feed still resolves.
 */
export async function generateRoomStream(theme, difficulty, onEvent) {
  let response;
  try {
    response = await fetch(`${API_BASE}/generate-room/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme, difficulty }),
    });
  } catch {
    throw new Error(
      "Could not reach the room generator. Is the backend running on localhost:3001?"
    );
  }

  if (!response.ok) {
    // Pre-stream rejections (400 validation, 429 rate limit) are plain JSON.
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* fall through to the generic message */
    }
    throw new Error(data?.error || `Room generation failed (status ${response.status}).`);
  }

  if (!response.body) {
    onEvent({ type: "stage", stage: "brief" });
    const room = await generateRoom(theme, difficulty);
    onEvent({ type: "room", room });
    return room;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let room = null;
  let inbandError = null;

  const handleLine = (line) => {
    if (!line) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return; // tolerate a torn line rather than killing the whole build
    }
    if (event.type === "ping") return;
    if (event.type === "room") room = event.room;
    if (event.type === "error") inbandError = event.error;
    onEvent(event);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, newline).trim());
      buffer = buffer.slice(newline + 1);
    }
  }
  handleLine(buffer.trim());

  if (inbandError) throw new Error(inbandError);
  if (!room) throw new Error("The build stream ended before the room arrived.");
  return room;
}
