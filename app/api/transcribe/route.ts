import { NextResponse } from "next/server";

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

  const ext = audio.type.includes("mp4") ? "mp4" : "webm";
  const outgoing = new FormData();
  outgoing.append("file", audio, `recording.${ext}`);
  outgoing.append("model", "whisper-1");
  outgoing.append("response_format", "json");
  outgoing.append("prompt", "తెలుగు పద్యం పఠనం. సుమతీ శతకము. వేమన శతకము.");

  // Retry up to 3 times on rate-limit (429) or transient server errors (5xx).
  // Waits: 1s, 2s, 4s — stays well within the 10s Vercel function timeout.
  const MAX_ATTEMPTS = 3;
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let r: Response;
    try {
      r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: outgoing,
      });
    } catch (e) {
      console.error(`Transcription network error (attempt ${attempt}):`, e);
      if (attempt === MAX_ATTEMPTS)
        return NextResponse.json({ error: "Transcription request failed." }, { status: 500 });
      await sleep(attempt * 1000);
      continue;
    }

    if (r.ok) {
      const data = await r.json();
      const transcript = typeof data.text === "string" ? data.text : "";
      return NextResponse.json({ transcript });
    }

    lastStatus = r.status;
    lastBody = await r.text().catch(() => "");

    // Retry on rate limit or server errors; bail immediately on client errors
    if (r.status !== 429 && r.status < 500) break;

    console.warn(`Whisper ${r.status} (attempt ${attempt}/${MAX_ATTEMPTS})`);
    if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1000);
  }

  console.error("Whisper API error after retries:", lastStatus, lastBody);
  return NextResponse.json({ error: "Transcription service error." }, { status: 502 });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
