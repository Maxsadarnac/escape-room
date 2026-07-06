const API_BASE = "http://localhost:3001";

export async function generateRoom(theme, difficulty) {
  let response;
  try {
    response = await fetch(`${API_BASE}/generate-room`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme, difficulty }),
    });
  } catch (err) {
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
