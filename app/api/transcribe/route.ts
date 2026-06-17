import { NextResponse } from "next/server";

// ════════════════════════════════════════════════════════════════════════════
// POST /api/transcribe
// Receives the user's recorded audio (multipart form, field "audio"), forwards
// it to OpenAI's Whisper transcription endpoint, and returns the recognized
// Telugu text. This has to live server-side because it needs OPENAI_API_KEY,
// which must never be sent to the browser — see SETUP.md for how to get a key
// and where to put it. If you'd rather use Google Cloud Speech-to-Text or
// Bhashini instead, swap the fetch() call below; the client only cares that
// this route returns { transcript: string } or { error: string }.
// ════════════════════════════════════════════════════════════════════════════

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Speech-to-text is not configured on the server (missing OPENAI_API_KEY)." },
      { status: 503 }
    );
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const audio = incoming.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio file provided." }, { status: 400 });
  }

  // Whisper picks the container format up from the filename extension, so
  // give it one that matches what the browser's MediaRecorder produced
  // (see useRecorder() in app/page.tsx — it records webm, falling back to mp4).
  const ext = audio.type.includes("mp4") ? "mp4" : "webm";

  const outgoing = new FormData();
  outgoing.append("file", audio, `recording.${ext}`);
  outgoing.append("model", "whisper-1");
  outgoing.append("language", "te"); // Telugu
  outgoing.append("response_format", "json");

  try {
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outgoing,
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("Whisper API error:", r.status, text);
      return NextResponse.json({ error: "Transcription service error." }, { status: 502 });
    }

    const data = await r.json();
    const transcript = typeof data.text === "string" ? data.text : "";
    return NextResponse.json({ transcript });
  } catch (e) {
    console.error("Transcription request failed:", e);
    return NextResponse.json({ error: "Transcription request failed." }, { status: 500 });
  }
}
