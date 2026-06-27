"use client";
import { useState, useRef, useEffect, useCallback, type CSSProperties } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ALL_POEMS, TS } from "@/lib/poems";
import { lyricsSimilarity, wordDiff, type WordDiffItem } from "@/lib/lyrics";

type Difficulty = "beginner" | "medium" | "advanced";
type SyncStatus = "perfect" | "good" | "warning" | "error";

interface PoemLine {
  tel: string;
  en: string;
}

interface Poem {
  id: string;
  num: number;
  src: string;
  srcEn: string;
  difficulty: Difficulty;
  title: string;
  titleEn: string;
  meaning: string;
  lines: PoemLine[];
}

interface AnalysisLineResult {
  i: number;
  tel: string;
  status: SyncStatus;
  off: number;
  tempo: number;
  feedback: string;
}

// Returned by runRealAnalysis() — sync/timing/rhythm only, before the speech-
// to-text lyrics check has run. `final` here is a sync/timing/rhythm-only
// fallback score, used only if lyrics transcription is unavailable.
interface RawAnalysis {
  sync: number;
  timing: number;
  rhythm: number;
  final: number;
  lineResults: AnalysisLineResult[];
  tips: string[];
  refWave: number[];
  usrWave: number[];
}

// The complete result shown in the results view, after lyrics content has
// been checked against the poem's actual text (see doAnalysis()).
interface AnalysisResult extends RawAnalysis {
  lyricsScore: number | null; // null when STT wasn't available
  transcript: string;
  wordDiffResult: WordDiffItem[]; // word-level diff for highlight display
}

// ══════════════════════════════════════════════════════════════════════════════
// SATAKA SANKHARAVAM — పద్యాల సంఖారవం
// Silicon Andhra Silver Jubilee · Guinness World Record Attempt · Oakland 2026
// 18 Padyalu: 9 Sumati Satakam (P1-P9) + 9 Vemana Satakam (P10-P18)
// ══════════════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════════════
// REAL AUDIO ANALYSIS ENGINE
// Replaces random scoring with actual signal comparison:
//   1. Decode reference segment + user recording to mono PCM
//   2. Extract per-frame RMS energy + autocorrelation pitch
//   3. Align the two feature sequences with Dynamic Time Warping (DTW)
//   4. Derive sync / timing / rhythm scores and per-line feedback from the
//      real alignment path — not from Math.random()
// ════════════════════════════════════════════════════════════════════════════

async function decodeToMono(buf: ArrayBuffer, targetSr = 16000): Promise<Float32Array> {
  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new AC();
  const audioBuf = await ctx.decodeAudioData(buf.slice(0));
  const ch0 = audioBuf.getChannelData(0);
  let mono: Float32Array;
  if (audioBuf.numberOfChannels > 1) {
    const ch1 = audioBuf.getChannelData(1);
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
  } else {
    mono = ch0;
  }
  const srcSr = audioBuf.sampleRate;
  let out: Float32Array;
  if (srcSr === targetSr) {
    out = mono;
  } else {
    const ratio = targetSr / srcSr;
    const outLen = Math.floor(mono.length * ratio);
    out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i / ratio;
      const i0 = Math.floor(srcIdx), i1 = Math.min(i0 + 1, mono.length - 1);
      const frac = srcIdx - i0;
      out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
    }
  }
  await ctx.close();
  return out;
}

interface FrameFeatures {
  rms: number[];
  pitch: number[];
  hopSec: number;
  times: number[];
}

function extractFeatures(samples: Float32Array, sr: number): FrameFeatures {
  const frameLen = Math.round(sr * 0.04);
  const hopLen = Math.round(sr * 0.02);
  const nFrames = Math.max(1, Math.floor((samples.length - frameLen) / hopLen));
  const rms: number[] = [];
  const pitch: number[] = [];
  const times: number[] = [];

  for (let f = 0; f < nFrames; f++) {
    const start = f * hopLen;
    const frame = samples.subarray(start, start + frameLen);
    let sumSq = 0;
    for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
    const e = Math.sqrt(sumSq / frame.length);
    rms.push(e);
    times.push(start / sr);

    if (e > 0.01) {
      const minLag = Math.floor(sr / 500);
      const maxLag = Math.floor(sr / 70);
      let bestLag = -1, bestCorr = 0;
      for (let lag = minLag; lag <= maxLag && lag < frame.length; lag++) {
        let corr = 0;
        for (let i = 0; i < frame.length - lag; i++) corr += frame[i] * frame[i + lag];
        if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
      }
      pitch.push(bestLag > 0 ? sr / bestLag : 0);
    } else {
      pitch.push(0);
    }
  }
  return { rms, pitch, hopSec: hopLen / sr, times };
}

function buildVectors(feat: FrameFeatures): number[][] {
  const maxRms = Math.max(1e-6, ...feat.rms);
  const maxPitch = Math.max(1, ...feat.pitch);
  return feat.rms.map((r, i) => [
    r / maxRms,
    feat.pitch[i] > 0 ? feat.pitch[i] / maxPitch : 0,
  ]);
}

function euclid(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

function dtw(ref: number[][], usr: number[][]): { normCost: number; path: [number, number][] } {
  const n = ref.length, m = usr.length;
  if (n === 0 || m === 0) return { normCost: 999, path: [] };
  const D: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  D[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const c = euclid(ref[i - 1], usr[j - 1]);
      D[i][j] = c + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
    }
  }
  const path: [number, number][] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const choices = [D[i - 1][j - 1], D[i - 1][j], D[i][j - 1]];
    const minIdx = choices.indexOf(Math.min(...choices));
    if (minIdx === 0) { i--; j--; }
    else if (minIdx === 1) { i--; }
    else { j--; }
  }
  path.reverse();
  return { normCost: D[n][m] / (n + m), path };
}

function analyzeLines(
  refFeat: FrameFeatures,
  usrFeat: FrameFeatures,
  path: [number, number][],
  numLines: number
): AnalysisLineResult[] {
  const refTotalFrames = refFeat.rms.length;
  const bounds: number[] = [];
  for (let l = 0; l <= numLines; l++) bounds.push(Math.round((l / numLines) * refTotalFrames));

  const results: AnalysisLineResult[] = [];
  for (let l = 0; l < numLines; l++) {
    const refStartF = bounds[l];
    const refEndF = bounds[l + 1];
    const matched = path.filter(([ri]) => ri >= refStartF && ri < refEndF);
    if (matched.length === 0) {
      results.push({ i: l, tel: "", status: "error", off: 0, tempo: 0, feedback: "No matching audio detected for this line" });
      continue;
    }
    const usrIdxs = matched.map(([, ui]) => ui);
    const usrStartF = Math.min(...usrIdxs);
    const usrEndF = Math.max(...usrIdxs);

    const refLineStartT = refFeat.times[refStartF] ?? 0;
    const usrLineStartT = usrFeat.times[usrStartF] ?? 0;
    const offsetSec = usrLineStartT - refLineStartT;

    const refDur = (refFeat.times[refEndF - 1] ?? refLineStartT) - refLineStartT + refFeat.hopSec;
    const usrDur = (usrFeat.times[usrEndF] ?? usrLineStartT) - usrLineStartT + usrFeat.hopSec;
    const tempoRatio = refDur > 0 ? usrDur / refDur : 1;

    const localCosts = matched.map(([ri, ui]) => {
      const re = refFeat.rms[ri] ?? 0, ue = usrFeat.rms[ui] ?? 0;
      return Math.abs(re - ue);
    });
    const avgLocalCost = localCosts.reduce((a, b) => a + b, 0) / localCosts.length;

    let status: SyncStatus;
    let feedback: string;
    const absOffset = Math.abs(offsetSec);
    const tempoDevPct = Math.abs(tempoRatio - 1) * 100;

    if (avgLocalCost < 0.06 && absOffset < 0.25 && tempoDevPct < 8) {
      status = "perfect"; feedback = "Perfect sync ✓";
    } else if (absOffset >= 0.25 && tempoDevPct < 12) {
      status = "good";
      feedback = offsetSec > 0 ? `Started ${absOffset.toFixed(1)}s late` : `Started ${absOffset.toFixed(1)}s early`;
    } else if (tempoDevPct >= 12 && tempoDevPct < 30) {
      status = "warning";
      feedback = tempoRatio > 1 ? `Sung ${Math.round(tempoDevPct)}% slower than reference` : `Sung ${Math.round(tempoDevPct)}% faster than reference`;
    } else if (tempoDevPct >= 30 || avgLocalCost > 0.15) {
      status = "error";
      feedback = "Significant mismatch — re-listen to this line";
    } else {
      status = "good"; feedback = "Close match";
    }

    results.push({ i: l, tel: "", status, off: +offsetSec.toFixed(2), tempo: +tempoRatio.toFixed(2), feedback });
  }
  return results;
}

function downsampleEnvelope(samples: Float32Array, buckets = 56): number[] {
  const out: number[] = [];
  const bucketSize = Math.max(1, Math.floor(samples.length / buckets));
  for (let b = 0; b < buckets; b++) {
    const start = b * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
    out.push(peak);
  }
  return out;
}

// Fetch the reference clip from Storage and extract the exact time range as WAV.
async function extractReferenceSegment(url: string, startSec: number, endSec: number): Promise<ArrayBuffer> {
  const res = await fetch(url);
  const fullBuf = await res.arrayBuffer();
  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(fullBuf.slice(0));
  const sr = decoded.sampleRate;
  const startSample = Math.floor(startSec * sr);
  const endSample = Math.min(decoded.length, Math.floor(endSec * sr));
  const len = Math.max(1, endSample - startSample);
  const nCh = decoded.numberOfChannels;

  // Build a minimal WAV (PCM16) for just this slice
  const slice = new Float32Array(len);
  const ch0 = decoded.getChannelData(0);
  for (let i = 0; i < len; i++) {
    let v = ch0[startSample + i] || 0;
    if (nCh > 1) {
      const ch1 = decoded.getChannelData(1);
      v = (v + (ch1[startSample + i] || 0)) / 2;
    }
    slice[i] = v;
  }
  await ctx.close();

  const wavBuf = new ArrayBuffer(44 + len * 2);
  const view = new DataView(wavBuf);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + len * 2, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, slice[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return wavBuf;
}

async function runRealAnalysis(
  clipUrl: string,
  poemStartSec: number,
  poemEndSec: number,
  userBlob: Blob,
  numLines: number
): Promise<RawAnalysis> {
  const SR = 16000;
  const [refSegBuf, userBuf] = await Promise.all([
    extractReferenceSegment(clipUrl, poemStartSec, poemEndSec),
    userBlob.arrayBuffer(),
  ]);

  const [refSamples, usrSamples] = await Promise.all([
    decodeToMono(refSegBuf, SR),
    decodeToMono(userBuf, SR),
  ]);

  const refFeat = extractFeatures(refSamples, SR);
  const usrFeat = extractFeatures(usrSamples, SR);
  const refVec = buildVectors(refFeat);
  const usrVec = buildVectors(usrFeat);
  const { normCost, path } = dtw(refVec, usrVec);

  const sync = Math.max(0, Math.min(100, Math.round(100 - normCost * 140)));
  const lineResults = analyzeLines(refFeat, usrFeat, path, numLines);

  const avgAbsOffset = lineResults.reduce((s, l) => s + Math.abs(l.off), 0) / Math.max(1, lineResults.length);
  const timing = Math.max(0, Math.min(100, Math.round(100 - avgAbsOffset * 60)));

  const avgTempoDev = lineResults.reduce((s, l) => s + Math.abs(l.tempo - 1), 0) / Math.max(1, lineResults.length);
  const rhythm = Math.max(0, Math.min(100, Math.round(100 - avgTempoDev * 110)));

  // Fallback final score (sync/timing/rhythm only) — used if lyrics
  // transcription fails or returns nothing usable. When transcription
  // succeeds, doAnalysis() recomputes `final` to weight lyrics content in too.
  const final = Math.round(sync * 0.5 + timing * 0.3 + rhythm * 0.2);

  const tips = lineResults
    .filter(l => l.status !== "perfect")
    .map(l => {
      if (l.status === "error") return `Line ${l.i + 1}: ${l.feedback} — listen closely and re-record`;
      if (l.status === "warning") return l.tempo > 1 ? `Line ${l.i + 1}: Speed up slightly to match the reference pace` : `Line ${l.i + 1}: Slow down slightly to match the reference pace`;
      return `Line ${l.i + 1}: Start ${l.off > 0 ? "a bit earlier" : "a bit later"} to align with the reference`;
    });

  return {
    sync, timing, rhythm, final, lineResults, tips,
    refWave: downsampleEnvelope(refSamples),
    usrWave: downsampleEnvelope(usrSamples),
  };
}

// ─── AUDIO ENGINE — plays only the poem's segment of the single MP3 ───────────
function useAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segRef = useRef<{ start: number; end: number }>({ start: 0, end: 382.78 });
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [elapsed, setElapsed] = useState(0);
  const [segDur, setSegDur] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const a = new Audio();
    a.preload = "none";
    a.oncanplaythrough = () => { setReady(true); setLoading(false); };
    a.onloadstart = () => setLoading(true);
    a.onerror = (e) => { setLoading(false); console.error("Audio error", e); };
    audioRef.current = a;
    return () => { a.pause(); a.src = ""; };
  }, []);

  useEffect(() => {
    if (!playing) {
      if (elapsedRef.current !== null) clearInterval(elapsedRef.current);
      return;
    }
    elapsedRef.current = setInterval(() => {
      const a = audioRef.current;
      if (!a) return;
      const { start, end } = segRef.current;
      const e = Math.max(0, a.currentTime - start);
      setElapsed(e);
      if (a.currentTime >= end) {
        a.pause();
        setPlaying(false);
        setElapsed(end - start);
      }
    }, 80);
    return () => {
      if (elapsedRef.current !== null) clearInterval(elapsedRef.current);
    };
  }, [playing]);

  const loadPoem = useCallback((url: string, startSec: number, endSec: number) => {
    segRef.current = { start: startSec, end: endSec };
    setSegDur(endSec - startSec);
    setElapsed(0);
    setPlaying(false);
    setReady(false);
    setLoading(true);
    const a = audioRef.current;
    if (a) { a.pause(); a.src = url; a.currentTime = startSec; a.load(); }
  }, []);

  const play = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.currentTime >= segRef.current.end) {
      a.currentTime = segRef.current.start;
      setElapsed(0);
    }
    a.playbackRate = speed;
    a.play().then(() => setPlaying(true)).catch((e: unknown) => console.error("Play failed:", e));
  }, [speed]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const restart = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = segRef.current.start;
    setElapsed(0);
  }, []);

  const seekInSegment = useCallback((frac: number) => {
    const a = audioRef.current;
    if (!a) return;
    const { start, end } = segRef.current;
    a.currentTime = start + frac * (end - start);
    setElapsed(frac * (end - start));
  }, []);

  const changeSpeed = useCallback((s: number) => {
    setSpeed(s);
    if (audioRef.current) audioRef.current.playbackRate = s;
  }, []);

  return { playing, loading, ready, speed, elapsed, segDur, play, pause, restart, loadPoem, seekInSegment, changeSpeed };
}

// ─── MICROPHONE RECORDER — real MediaRecorder capture ─────────────────────────
const MAX_RECORD_SECS = 30;

function useRecorder() {
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechRecRef = useRef<{ stop: () => void } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [speechTranscript, setSpeechTranscript] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setRecordedBlob(null);
    setSpeechTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        setRecordedBlob(blob);
        stream.getTracks().forEach(t => t.stop());
        if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
      };
      rec.start();
      mediaRecRef.current = rec;
      setRecording(true);

      // Run Web Speech API in parallel during recording (free STT on Android Chrome).
      // Collects all interim+final results; doAnalysis() uses this and falls back
      // to Whisper if empty (iOS, Firefox, browsers without te-IN support).
      type AnySpeechRecognition = { new(): { lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void; } };
      const w = window as unknown as { SpeechRecognition?: AnySpeechRecognition; webkitSpeechRecognition?: AnySpeechRecognition };
      const SpeechRecAPI = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      if (SpeechRecAPI) {
        const sr = new SpeechRecAPI();
        sr.lang = "te-IN";
        sr.continuous = true;
        sr.interimResults = true;
        sr.maxAlternatives = 1;
        sr.onresult = (e) => {
          const collected = Array.from(e.results).map(r => r[0].transcript).join(" ");
          setSpeechTranscript(collected);
        };
        sr.onerror = () => {};
        sr.start();
        speechRecRef.current = sr;
      }

      // Auto-stop after MAX_RECORD_SECS
      autoStopRef.current = setTimeout(() => {
        mediaRecRef.current?.stop();
        try { speechRecRef.current?.stop(); } catch {}
        setRecording(false);
      }, MAX_RECORD_SECS * 1000);
    } catch (e) {
      console.error("Mic access failed:", e);
      setError("Microphone access denied or unavailable. Please allow microphone permission and try again.");
      setRecording(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    mediaRecRef.current?.stop();
    try { speechRecRef.current?.stop(); } catch {}
    setRecording(false);
  }, []);

  const reset = useCallback(() => {
    setRecordedBlob(null);
    setSpeechTranscript("");
    setError(null);
  }, []);

  return { recording, recordedBlob, speechTranscript, error, start, stop, reset };
}

// Play back an arbitrary Blob (used for the user's own recording)
function useBlobPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const play = useCallback((blob: Blob) => {
    // Stop and fully tear down any previous instance first — otherwise every
    // call creates a brand-new <audio>, leaving the old one still playing
    // underneath (the "starts another play" bug).
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const a = new Audio(url);
    a.onended = () => setPlaying(false);
    audioRef.current = a;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return { playing, play, stop };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmt(s: number | null | undefined) {
  s = Math.floor(Math.max(0, s || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Gauge({ score, label, sz = 74 }: { score: number; label: string; sz?: number }) {
  const r = sz / 2 - 7, c = 2 * Math.PI * r;
  const col = score >= 85 ? "#22c55e" : score >= 65 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <svg width={sz} height={sz}>
        <circle cx={sz / 2} cy={sz / 2} r={r} fill="none" stroke="#1e293b" strokeWidth="5"
          strokeDasharray={`${c * 0.75} ${c * 0.25}`} strokeDashoffset={c * -0.125} strokeLinecap="round" />
        <circle cx={sz / 2} cy={sz / 2} r={r} fill="none" stroke={col} strokeWidth="5"
          strokeDasharray={`${c * 0.75} ${c * 0.25}`}
          strokeDashoffset={c * (1 - score / 100 * 0.75) - c * 0.125}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 1.2s ease" }} />
        <text x={sz / 2} y={sz / 2 + 1} textAnchor="middle" dominantBaseline="middle"
          fill="white" fontSize={sz * 0.21} fontWeight="700">{score}</text>
      </svg>
      <span style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

function Wave({ active, color = "#6366f1", bars = 44 }: { active: boolean; color?: string; bars?: number }) {
  const [h, setH] = useState<number[]>(() => Array.from({ length: bars }, () => 4));
  useEffect(() => {
    if (!active) { setH(Array.from({ length: bars }, () => 4)); return; }
    const t = setInterval(() => setH(Array.from({ length: bars }, () => 3 + Math.random() * 36)), 75);
    return () => clearInterval(t);
  }, [active, bars]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 1.5, height: 44, padding: "2px 4px" }}>
      {h.map((v, i) => <div key={i} style={{ width: 2, height: v, background: color, borderRadius: 1, transition: "height 0.075s ease", flexShrink: 0 }} />)}
    </div>
  );
}

// Static (real-data) waveform bar, used in the results comparison view
function StaticWave({ data, color }: { data: number[]; color: string }) {
  const maxV = Math.max(0.001, ...data);
  return (
    <div style={{ display: "flex", gap: 1.5, height: 32, alignItems: "center", background: "#0a0f1e", padding: "3px 8px", borderRadius: 6, overflow: "hidden" }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, height: 4 + (v / maxV) * 24, background: color, borderRadius: 1, opacity: 0.85 }} />
      ))}
    </div>
  );
}

function Diff({ level }: { level: Difficulty }) {
  const m: Record<Difficulty, { bg: string; tc: string; lbl: string }> = {
    beginner: { bg: "#064e3b", tc: "#6ee7b7", lbl: "Beginner" },
    medium: { bg: "#1e3a5f", tc: "#93c5fd", lbl: "Intermediate" },
    advanced: { bg: "#4c1d95", tc: "#c4b5fd", lbl: "Advanced" }
  };
  const s = m[level] || m.medium;
  return <span style={{ background: s.bg, color: s.tc, fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{s.lbl}</span>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const router = useRouter();
  const supabaseRef = useRef(createClient());
  const [view, setView] = useState<"home" | "practice" | "record" | "results">("home");
  const [poem, setPoem] = useState<Poem | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showTel, setShowTel] = useState(true);
  const [showEn, setShowEn] = useState(true);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [curLine, setCurLine] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [profile, setProfile] = useState<{ username: string; role: string } | null>(null);
  const [overallTips, setOverallTips] = useState<string[]>([]);
  const [leaderboard, setLeaderboard] = useState<{ username: string; poems_done: number; avg_score: number }[]>([]);
  const [clip, setClip] = useState<{ url: string; start: number; end: number } | null>(null);
  const [clipLoading, setClipLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const lineTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audio = useAudio();
  const recorder = useRecorder();
  const refPlayer = useBlobPlayer(); // plays the reference segment slice (for results view)
  const usrPlayer = useBlobPlayer(); // plays the user's own recording
  const [recSecs, setRecSecs] = useState(0);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── AUTH + LOAD BEST SCORES ──────────────────────────────────────────────
  // The middleware (middleware.ts) already redirects unauthenticated visitors
  // to /login server-side before this component ever mounts, so this is
  // mostly about fetching the things only available client-side: which user
  // is signed in (for saving attempts under their id), their profile
  // (username + role, for the header and the admin link), and their best
  // score per poem so far (replacing the old sessionStorage-only scores).
  useEffect(() => {
    const supabase = supabaseRef.current;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) { router.push("/login"); return; }
      setUser({ id: authData.user.id });

      const { data: prof } = await supabase
        .from("profiles")
        .select("username, role")
        .eq("id", authData.user.id)
        .single();
      if (prof) setProfile(prof);

      const { data: attempts } = await supabase
        .from("attempts")
        .select("poem_id, final_score")
        .eq("user_id", authData.user.id);
      if (attempts) {
        const best: Record<string, number> = {};
        for (const a of attempts) best[a.poem_id] = Math.max(best[a.poem_id] ?? 0, a.final_score);
        setScores(best);
      }

      const { data: lb } = await supabase.rpc("get_leaderboard");
      if (lb) setLeaderboard(lb as { username: string; poems_done: number; avg_score: number }[]);

      setAuthChecked(true);
    })();
  }, [router]);

  // Aggregate the most frequent improvement tips across the user's recent
  // attempts into a single "Your Overall Suggestions" list on the home page.
  // Re-runs whenever `scores` changes (i.e. right after a new attempt saves).
  useEffect(() => {
    if (!user) return;
    const supabase = supabaseRef.current;
    (async () => {
      const { data } = await supabase
        .from("attempts")
        .select("tips")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15);
      if (!data) return;
      const freq = new Map<string, number>();
      for (const row of data as { tips: string[] | null }[]) {
        for (const t of row.tips ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
      }
      const top = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([t]) => t);
      setOverallTips(top);
    })();
  }, [user, scores]);

  const signOut = async () => {
    await supabaseRef.current.auth.signOut();
    window.location.href = "/login";
  };

  const submitFeedback = async () => {
    if (!user || !feedbackMsg.trim()) return;
    const { error } = await supabaseRef.current
      .from("suggestions")
      .insert({ user_id: user.id, message: feedbackMsg.trim(), poem_id: poem?.id ?? null });
    if (!error) {
      setFeedbackMsg("");
      setFeedbackSent(true);
      setTimeout(() => setFeedbackSent(false), 4000);
    }
  };

  useEffect(() => {
    if (!audio.playing || !poem) return;
    if (lineTimer.current !== null) clearInterval(lineTimer.current);
    const n = poem.lines.length;
    const segMs = (audio.segDur / audio.speed) * 1000;
    const perLine = segMs / n;
    let idx = 0;
    setCurLine(0);
    lineTimer.current = setInterval(() => {
      idx += 1;
      if (idx < n) setCurLine(idx);
      else if (lineTimer.current !== null) clearInterval(lineTimer.current);
    }, perLine);
    return () => {
      if (lineTimer.current !== null) clearInterval(lineTimer.current);
    };
  }, [audio.playing, audio.segDur, audio.speed, poem]);

  useEffect(() => {
    if (recorder.recording) {
      setRecSecs(0);
      recTimer.current = setInterval(() => setRecSecs(s => s + 1), 1000);
    } else if (recTimer.current !== null) {
      clearInterval(recTimer.current);
    }
    return () => { if (recTimer.current !== null) clearInterval(recTimer.current); };
  }, [recorder.recording]);

  const goPoem = async (p: Poem) => {
    setPoem(p); setView("practice"); setCurLine(0);
    recorder.reset(); setAnalysis(null); setAnalyzeError(null);
    setClip(null); setClipLoading(true);
    audio.pause();
    const { data } = await supabaseRef.current
      .from("reference_clips")
      .select("storage_path, start_sec, end_sec")
      .eq("poem_id", p.id)
      .single();
    if (data) {
      const { data: { publicUrl } } = supabaseRef.current.storage
        .from("reference-audio")
        .getPublicUrl(data.storage_path);
      const c = { url: publicUrl, start: data.start_sec, end: data.end_sec };
      setClip(c);
      audio.loadPoem(c.url, c.start, c.end);
    }
    setClipLoading(false);
  };

  const startRec = () => {
    // Stop any reference playback first so it can't keep going underneath
    // the recording (the "play reference still playing" bug).
    audio.pause();
    refPlayer.stop();
    let c = 3; setCountdown(c);
    const cd = setInterval(() => {
      c--;
      if (c > 0) setCountdown(c);
      else { clearInterval(cd); setCountdown(null); recorder.start(); }
    }, 1000);
  };
  const stopRec = () => { recorder.stop(); };
  const resetRec = () => { recorder.reset(); setAnalysis(null); setAnalyzeError(null); };

  const doAnalysis = async () => {
    if (!poem || !recorder.recordedBlob || !clip) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const raw = await runRealAnalysis(clip.url, clip.start, clip.end, recorder.recordedBlob, poem.lines.length);

      // Lyrics content check: during recording, capture via Web Speech API in
      // parallel (free, instant on Android Chrome with te-IN). After recording
      // stops we compare whatever was captured; fall back to Whisper if empty
      // (covers iOS and browsers without Telugu STT support).
      let transcript = recorder.speechTranscript ?? "";
      let lyricsScore: number | null = null;
      let wordDiffResult: WordDiffItem[] = [];

      // Fall back to Whisper when Web Speech returned nothing
      if (!transcript.trim()) {
        try {
          const fd = new FormData();
          const ext = recorder.recordedBlob.type.includes("mp4") ? "mp4" : "webm";
          fd.append("audio", recorder.recordedBlob, `recording.${ext}`);
          const r = await fetch("/api/transcribe", { method: "POST", body: fd });
          if (r.ok) {
            const data = await r.json();
            if (typeof data.transcript === "string") transcript = data.transcript;
          } else {
            console.warn("Transcription unavailable:", r.status);
          }
        } catch (e) {
          console.error("Transcription request failed:", e);
        }
      }

      if (transcript.trim()) {
        const referenceText = poem.lines.map(l => l.tel).join(" ");
        lyricsScore = lyricsSimilarity(transcript, referenceText);
        wordDiffResult = wordDiff(transcript, referenceText);
      }

      // Final score: lyrics content is the heaviest-weighted factor (catching
      // wrong-words recordings that the old engine scored highly), with
      // sync/timing/rhythm filling out the rest. If lyrics scoring wasn't
      // available (e.g. unsupported recording codec, STT not configured),
      // fall back to raw.final (sync/timing/rhythm only).
      const final = lyricsScore !== null
        ? Math.round(lyricsScore * 0.25 + raw.sync * 0.35 + raw.timing * 0.25 + raw.rhythm * 0.15)
        : raw.final;

      const tips = lyricsScore !== null && lyricsScore < 50
        ? [`Your recited words matched ${lyricsScore}% of the poem's text — try reviewing the lyrics and re-recording.`, ...raw.tips]
        : raw.tips;

      const res: AnalysisResult = { ...raw, tips, final, lyricsScore, transcript, wordDiffResult };
      setAnalysis(res);
      await saveAttempt(poem, res);
      setView("results");
    } catch (e) {
      console.error("Analysis failed:", e);
      setAnalyzeError("Could not analyze the recording. Please try recording again.");
    } finally {
      setAnalyzing(false);
    }
  };

  // Persists one attempt to Supabase (RLS restricts this to the signed-in
  // user's own rows — see supabase/schema.sql) and updates the local best-
  // score cache so the home page poem grid reflects it immediately.
  const saveAttempt = async (p: Poem, res: AnalysisResult) => {
    if (!user) return;
    setScores(prev => ({ ...prev, [p.id]: Math.max(prev[p.id] ?? 0, res.final) }));
    const { error } = await supabaseRef.current.from("attempts").insert({
      user_id: user.id,
      poem_id: p.id,
      sync_score: res.sync,
      timing_score: res.timing,
      rhythm_score: res.rhythm,
      lyrics_score: res.lyricsScore,
      final_score: res.final,
      transcript: res.transcript || null,
      tips: res.tips,
    });
    if (error) { console.error("Failed to save attempt:", error); return; }
    const { data: lb } = await supabaseRef.current.rpc("get_leaderboard");
    if (lb) setLeaderboard(lb as { username: string; poems_done: number; avg_score: number }[]);
  };

  const playReferenceSegment = useCallback(async () => {
    if (!poem || !clip) return;
    usrPlayer.stop();
    try {
      const wavBuf = await extractReferenceSegment(clip.url, clip.start, clip.end);
      refPlayer.play(new Blob([wavBuf], { type: "audio/wav" }));
    } catch (e) {
      console.error("Reference playback failed:", e);
    }
  }, [poem, clip, refPlayer, usrPlayer]);

  const done = Object.keys(scores).length;
  const avgSc = done > 0 ? Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / done) : 0;

  // ─── SHARED STYLES ──────────────────────────────────────────────────────────
  const BG = "#030712";
  const card: CSSProperties = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 18, marginBottom: 12 };
  const hdr: CSSProperties = {
    background: "linear-gradient(135deg,#0f172a,#1e1b4b,#0f172a)", borderBottom: "1px solid #1e293b",
    padding: "0 16px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between",
    position: "sticky", top: 0, zIndex: 100
  };
  type ButtonVariant = "pri" | "ok" | "red" | "warn" | "ghost";
  const btn = (v: ButtonVariant): React.CSSProperties => {
    const vs: Record<ButtonVariant, React.CSSProperties> = {
      pri: { background: "linear-gradient(135deg,#4f46e5,#7c3aed)", color: "white", border: "none" },
      ok: { background: "linear-gradient(135deg,#059669,#047857)", color: "white", border: "none" },
      red: { background: "linear-gradient(135deg,#dc2626,#b91c1c)", color: "white", border: "none" },
      warn: { background: "linear-gradient(135deg,#d97706,#b45309)", color: "white", border: "none" },
      ghost: { background: "transparent", color: "#94a3b8", border: "1px solid #334155" },
    };
    return {
      ...vs[v], padding: "9px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer",
      fontFamily: "inherit", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6
    };
  };
  const W: CSSProperties = { maxWidth: 880, margin: "0 auto", padding: "20px 14px" };

  // ══ AUTH LOADING ════════════════════════════════════════════════════════════
  // middleware.ts already keeps unauthenticated visitors on /login server-side,
  // so this is brief — just covers the moment between mount and the client
  // finishing its own getUser()/profile/scores fetch above.
  if (!authChecked) return (
    <div style={{ minHeight: "100vh", background: BG, color: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI',sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📜</div>
        <div style={{ fontSize: 13, color: "#64748b" }}>Loading…</div>
      </div>
    </div>
  );

  // ══ HOME ════════════════════════════════════════════════════════════════════
  if (view === "home") return (
    <div style={{ minHeight: "100vh", background: BG, color: "#e2e8f0", fontFamily: "'Segoe UI',sans-serif" }}>
      <div style={hdr}>
        <div style={{ background: "white", borderRadius: 8, padding: "3px 8px", display: "flex", alignItems: "center" }}>
          <Image src="/sasj-logo1.webp" alt="Silicon Andhra" width={120} height={30} style={{ objectFit: "contain", display: "block" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {profile && <span style={{ fontSize: 11, color: "#64748b" }}>👤 {profile.username}</span>}
          {profile?.role === "admin" && (
            <button style={{ ...btn("warn"), padding: "5px 12px", fontSize: 12 }} onClick={() => router.push("/admin")}>⚙ Admin</button>
          )}
          <button style={{ ...btn("ghost"), padding: "5px 12px", fontSize: 12 }} onClick={signOut}>Sign Out</button>
        </div>
      </div>
      <div style={{ background: "linear-gradient(160deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)", padding: "36px 16px 28px", textAlign: "center", borderBottom: "1px solid #1e293b" }}>
        <div style={{ fontSize: 11, color: "#f59e0b", letterSpacing: "0.18em", marginBottom: 6, fontFamily: "monospace", textTransform: "uppercase" }}>Silicon Andhra · Silver Jubilee · Oakland 2026</div>
        <h1 style={{ fontSize: "clamp(18px,4.5vw,34px)", fontWeight: 900, margin: "0 0 2px", color: "#c9a227", lineHeight: 1.25 }}>సిలికానాంధ్ర రజతోత్సవం</h1>
        <h2 style={{ fontSize: "clamp(14px,3.5vw,24px)", fontWeight: 700, margin: "0 0 4px", color: "#f1f5f9" }}>శతక శంఖారావం అభ్యాసం</h2>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>Guinness World Record Attempt · 1800+ participants · 18 Padyalu</div>
        {done > 0 && (
          <div style={{ display: "inline-flex", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, overflow: "hidden" }}>
            {[["✓ " + done, "Practiced", "#4ade80"], [avgSc + "%", "Avg Score", "#6366f1"], [(18 - done) + " left", "To Go", "#f59e0b"]].map(([v, l, c], i) => (
              <div key={i} style={{ padding: "10px 18px", borderRight: i < 2 ? "1px solid #1e293b" : "none", textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div>
                <div style={{ fontSize: 10, color: "#64748b" }}>{l}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={W}>
        <div style={{ background: "#0c1a2e", border: "1px solid #1d4ed8", borderRadius: 10, padding: "10px 14px", marginBottom: 18, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>🎵</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#93c5fd" }}>Reference audio loaded per poem — select below to practice</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Audio is fetched when you open a poem · Admin can upload clips via ⚙ Admin</div>
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9", marginBottom: 12 }}>అన్ని పద్యాలు — All 18 Padyalu</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {[["సుమతీ శతకము", "#f59e0b", "1–9"], ["వేమన శతకము", "#a78bfa", "10–18"]].map(([lbl, col, range]) => (
            <div key={lbl} style={{ display: "flex", gap: 6, alignItems: "center", background: "#0a0f1e", border: `1px solid ${col}44`, borderRadius: 8, padding: "5px 12px" }}>
              <span style={{ width: 7, height: 7, background: col, borderRadius: "50%", display: "inline-block" }} />
              <span style={{ fontSize: 11, color: col, fontWeight: 700 }}>{lbl} (Poems {range})</span>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(255px,1fr))", gap: 10 }}>
          {ALL_POEMS.map(p => {
            const sc = scores[p.id];
            const isSumati = p.src.includes("సుమతీ");
            const seg = TS[p.num - 1];
            const dur = Math.round(seg.end - seg.start);
            return (
              <div key={p.id} onClick={() => goPoem(p)}
                style={{
                  background: sc ? "#0f2318" : "#0f172a", border: `1px solid ${sc ? "#166534" : "#1e293b"}`,
                  borderLeft: `3px solid ${isSumati ? "#f59e0b" : "#a78bfa"}`,
                  borderRadius: 10, padding: 14, cursor: "pointer", position: "relative", transition: "all 0.18s"
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 20px #0006"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
                {sc && <span style={{ position: "absolute", top: 10, right: 10, background: sc >= 85 ? "#166534" : sc >= 65 ? "#1e3a5f" : "#7f1d1d", color: sc >= 85 ? "#4ade80" : sc >= 65 ? "#93c5fd" : "#fca5a5", fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: 20 }}>{sc}%</span>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <span style={{ fontSize: 18, color: isSumati ? "#f59e0b" : "#a78bfa", lineHeight: 1, fontWeight: 800 }}>{p.num}</span>
                  <Diff level={p.difficulty} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 1, lineHeight: 1.3 }}>{p.title}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>{p.titleEn}</div>
                <div style={{ fontSize: 10, color: isSumati ? "#f59e0b88" : "#a78bfa88", fontWeight: 600, marginBottom: 6 }}>{p.src}</div>
                <div style={{ fontSize: 10, color: "#475569", display: "flex", gap: 10 }}>
                  <span>⏱ ~{dur}s</span>
                  <span>📝 {p.lines.length} lines</span>
                  {sc && <span style={{ color: "#4ade80" }}>✓ Done</span>}
                </div>
              </div>
            );
          })}
        </div>
        {/* ── LEADERBOARD ─────────────────────────────────────────────── */}
        <div style={{ ...card, marginTop: 24, background: "#0a0f1e", border: "1px solid #1e293b" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", marginBottom: 12 }}>🏆 Leaderboard</div>
          {leaderboard.length === 0 ? (
            <p style={{ fontSize: 12, color: "#475569" }}>No practice attempts yet — be the first on the board!</p>
          ) : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 280 }}>
                <thead>
                  <tr style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left" }}>
                    <th style={{ padding: "4px 8px", width: 32 }}>#</th>
                    <th style={{ padding: "4px 8px" }}>Username</th>
                    <th style={{ padding: "4px 8px", textAlign: "center" }}>Practiced</th>
                    <th style={{ padding: "4px 8px", textAlign: "center" }}>Avg Score</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, i) => {
                    const isMe = row.username === profile?.username;
                    const rankColor = i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : i === 2 ? "#b45309" : "#475569";
                    const scoreColor = row.avg_score >= 85 ? "#4ade80" : row.avg_score >= 65 ? "#93c5fd" : row.avg_score > 0 ? "#fca5a5" : "#475569";
                    return (
                      <tr key={row.username} style={{
                        borderTop: "1px solid #1e293b",
                        background: isMe ? "#1e1b4b33" : "transparent",
                      }}>
                        <td style={{ padding: "9px 8px", fontWeight: 800, color: rankColor, fontSize: 12 }}>{i + 1}</td>
                        <td style={{ padding: "9px 8px", color: isMe ? "#a5b4fc" : "#e2e8f0", fontWeight: isMe ? 700 : 500 }}>
                          {row.username}{isMe && <span style={{ fontSize: 10, color: "#6366f1", marginLeft: 5 }}>you</span>}
                        </td>
                        <td style={{ padding: "9px 8px", textAlign: "center" }}>
                          <span style={{
                            background: row.poems_done === 18 ? "#166534" : "#1e293b",
                            color: row.poems_done === 18 ? "#4ade80" : "#93c5fd",
                            padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          }}>{row.poems_done}/18</span>
                        </td>
                        <td style={{ padding: "9px 8px", textAlign: "center", color: scoreColor, fontWeight: 700 }}>
                          {row.avg_score > 0 ? `${row.avg_score}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ ...card, marginTop: 16, background: "#0c1a0a", border: "1px solid #166534" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#4ade80", marginBottom: 10 }}>💡 Your Overall Suggestions</div>
          {overallTips.length > 0 ? (
            <>
              <p style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>The most common feedback across your recent attempts:</p>
              {overallTips.map((t, i) => (
                <div key={i} style={{ fontSize: 12, color: "#86efac", marginBottom: 5, display: "flex", gap: 8 }}>
                  <span>→</span><span>{t}</span>
                </div>
              ))}
            </>
          ) : (
            <p style={{ fontSize: 12, color: "#475569" }}>
              Record and submit a poem to get personalised improvement suggestions here.
            </p>
          )}
        </div>
        <div style={{ ...card, marginTop: 16, background: "#0a0f1e" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", marginBottom: 10 }}>How to Practice</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 10 }}>
            {[["1️⃣", "Pick a poem from the grid"], ["2️⃣", "Read the Telugu text"], ["3️⃣", "Play the reference audio"], ["4️⃣", "Sing along with karaoke"], ["5️⃣", "Record your voice"], ["6️⃣", "Get AI sync feedback"]].map(([ic, tx]) => (
              <div key={ic} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14 }}>{ic}</span>
                <span style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>{tx}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", marginBottom: 6 }}>Send Feedback to the Organizers</div>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>Spotted an issue with a poem's text or timing, or have a suggestion? Fill out the form below.</p>
          <a
            href="https://forms.gle/PQhmtN4F1aDAtSUg9"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block", padding: "9px 20px", borderRadius: 8,
              background: "linear-gradient(90deg,#991b1b,#b91c1c)",
              color: "white", fontWeight: 700, fontSize: 13, textDecoration: "none",
              fontFamily: "inherit",
            }}
          >
            Open Feedback Form →
          </a>
        </div>
      </div>
    </div>
  );

  // ══ PRACTICE ════════════════════════════════════════════════════════════════
  if (view === "practice" && poem) {
    const isSumati = poem.src.includes("సుమతీ");
    const sc = scores[poem.id];
    const poemDur = audio.segDur;
    const pct = poemDur > 0 ? (audio.elapsed / poemDur) * 100 : 0;
    return (
      <div style={{ minHeight: "100vh", background: BG, color: "#e2e8f0", fontFamily: "'Segoe UI',sans-serif" }}>
        <div style={hdr}>
          <button style={{ ...btn("ghost"), padding: "4px 10px", fontSize: 12 }} onClick={() => { audio.pause(); setView("home"); }}>← Home</button>
          <span style={{ fontSize: 12, color: "#64748b" }}>Poem {poem.num} of 18</span>
          <button style={{ ...btn("ok"), padding: "5px 12px", fontSize: 12 }} onClick={() => setView("record")} disabled={!clip}>Record →</button>
        </div>
        <div style={W}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: isSumati ? "#f59e0b" : "#a78bfa", fontWeight: 700, letterSpacing: "0.06em", marginBottom: 2 }}>{poem.src} · {poem.srcEn}</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", margin: "0 0 2px" }}>{poem.num}. {poem.title}</h2>
            <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>{poem.titleEn} · {poem.lines.length} lines{clip ? ` · ~${Math.round(poemDur)}s` : ""}{ sc ? ` · Best: ${sc}%` : ""}</p>
            {clipLoading && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 6 }}>⏳ Loading audio…</div>}
            {!clipLoading && !clip && <div style={{ fontSize: 11, color: "#f87171", marginTop: 6 }}>⚠ No reference audio uploaded for this poem yet. Ask an admin to upload it.</div>}
          </div>
          {poem.meaning && (
            <div style={{ background: "#0c1a0a", border: "1px solid #166534", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10 }}>
              <span>📖</span>
              <div>
                <div style={{ fontSize: 10, color: "#4ade80", fontWeight: 700, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>Meaning</div>
                <div style={{ fontSize: 12, color: "#86efac", lineHeight: 1.7 }}>{poem.meaning}</div>
              </div>
            </div>
          )}
          <div style={{ ...card, background: "linear-gradient(135deg,#0f172a,#1e1b4b)" }}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Reference Audio — Poem {poem.num} Only
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <button style={btn(audio.playing ? "warn" : "pri")}
                onClick={() => audio.playing ? audio.pause() : audio.play()}>
                {audio.loading ? "⏳ Loading..." : audio.playing ? "⏸ Pause" : "▶ Play Poem " + poem.num}
              </button>
              <button style={{ ...btn("ghost"), padding: "6px 12px", fontSize: 12 }}
                onClick={() => { audio.restart(); }}>↩ Restart</button>
              <div style={{ display: "flex", gap: 6 }}>
                {[0.75, 1.0, 1.25].map(s => (
                  <button key={s} onClick={() => audio.changeSpeed(s)}
                    style={{
                      background: audio.speed === s ? "#4f46e5" : "#1e293b", color: audio.speed === s ? "white" : "#64748b",
                      border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 700
                    }}>
                    {s}×
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 11, color: "#475569", marginLeft: "auto" }}>
                {fmt(audio.elapsed)} / {fmt(poemDur)}
              </span>
            </div>
            <div style={{ height: 5, background: "#1e293b", borderRadius: 3, marginBottom: 8, cursor: "pointer", overflow: "hidden" }}
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); audio.seekInSegment((e.clientX - r.left) / r.width); }}>
              <div style={{
                height: "100%", background: "linear-gradient(90deg,#4f46e5,#7c3aed)",
                width: `${Math.min(100, pct)}%`, transition: "width 0.1s linear", borderRadius: 3
              }} />
            </div>
            <Wave active={audio.playing} color="#6366f1" />
            {clip && !audio.ready && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 6 }}>⏳ Fetching audio… please wait</div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button onClick={() => setShowTel(!showTel)} style={{ ...btn(showTel ? "pri" : "ghost"), padding: "5px 12px", fontSize: 11 }}>{showTel ? "✓" : "○"} Telugu</button>
            <button onClick={() => setShowEn(!showEn)} style={{ ...btn(showEn ? "ok" : "ghost"), padding: "5px 12px", fontSize: 11 }}>{showEn ? "✓" : "○"} Transliteration</button>
          </div>
          <div style={card}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              {audio.playing ? "▶ Karaoke Mode — Follow the highlighted line" : "Read Along"}
            </div>
            {poem.lines.map((line, i) => {
              const active = audio.playing && curLine === i;
              return (
                <div key={i} style={{
                  padding: "10px 12px", borderRadius: 8, marginBottom: 7,
                  background: active ? "linear-gradient(135deg,#1e1b4b,#0f2438)" : "#111827",
                  border: `1px solid ${active ? "#4f46e5" : "#1e293b"}`,
                  borderLeft: `3px solid ${active ? "#6366f1" : "#1e293b"}`, transition: "all 0.3s"
                }}>
                  <div style={{ fontSize: 10, color: "#475569", marginBottom: 3 }}>Line {i + 1}</div>
                  {showTel && <div style={{ fontSize: 17, color: active ? "#e2e8f0" : "#94a3b8", fontWeight: active ? 700 : 400, lineHeight: 1.65, marginBottom: showEn ? 3 : 0, transition: "all 0.3s" }}>{line.tel}</div>}
                  {showEn && <div style={{ fontSize: 12, color: active ? "#93c5fd" : "#475569", fontStyle: "italic", lineHeight: 1.5 }}>{line.en}</div>}
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: "center" }}>
            <button style={btn("ok")} onClick={() => setView("record")}>🎙 Record My Voice →</button>
          </div>
        </div>
      </div>
    );
  }

  // ══ RECORD ══════════════════════════════════════════════════════════════════
  if (view === "record" && poem) return (
    <div style={{ minHeight: "100vh", background: BG, color: "#e2e8f0", fontFamily: "'Segoe UI',sans-serif" }}>
      <div style={hdr}>
        <button style={{ ...btn("ghost"), padding: "4px 10px", fontSize: 12 }} onClick={() => setView("practice")}>← Practice</button>
        <span style={{ fontSize: 12, color: "#64748b" }}>Record — Poem {poem.num}</span>
        <div style={{ width: 64 }} />
      </div>
      <div style={W}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", margin: "0 0 4px" }}>{poem.num}. {poem.title}</h2>
          <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>Sing along · AI will compare and score your synchronization</p>
        </div>
        {countdown !== null && (
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 80, fontWeight: 900, color: "#f59e0b", lineHeight: 1 }}>{countdown}</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Get ready to sing...</div>
          </div>
        )}
        <div style={{
          ...card, textAlign: "center",
          background: recorder.recording ? "linear-gradient(135deg,#1a0000,#3d0000)" : "#0f172a",
          border: `1px solid ${recorder.recording ? "#dc2626" : "#1e293b"}`, transition: "all 0.3s"
        }}>
          {recorder.error && (
            <div style={{ background: "#1a0000", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#fca5a5", fontSize: 12 }}>
              ⚠ {recorder.error}
            </div>
          )}
          {!recorder.recordedBlob && !recorder.recording && countdown === null && (
            <>
              <div style={{ fontSize: 44, marginBottom: 10 }}>🎙</div>
              <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 6 }}>Ready to record?</div>
              <p style={{ fontSize: 12, color: "#475569", marginBottom: 18, lineHeight: 1.6 }}>Allow microphone access when prompted. A 3-second countdown will begin before recording starts. Sing the poem as you practiced — your voice will be compared against the actual reference audio.</p>
              <button style={btn("ok")} onClick={startRec}>🎙 Start Recording</button>
            </>
          )}
          {recorder.recording && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 9, height: 9, background: "#ef4444", borderRadius: "50%", animation: "pulse 1s infinite" }} />
                <span style={{ fontSize: 14, color: "#ef4444", fontWeight: 700, fontFamily: "monospace" }}>RECORDING · {fmt(recSecs)} / {fmt(MAX_RECORD_SECS)}</span>
              </div>
              <div style={{ height: 4, background: "#1e293b", borderRadius: 2, margin: "6px 0 10px", overflow: "hidden" }}>
                <div style={{ height: "100%", background: "#ef4444", width: `${Math.min(100, (recSecs / MAX_RECORD_SECS) * 100)}%`, transition: "width 1s linear", borderRadius: 2 }} />
              </div>
              <Wave active={true} color="#ef4444" />
              <div style={{ marginTop: 14 }}><button style={btn("red")} onClick={stopRec}>⏹ Stop Recording</button></div>
            </>
          )}
          {recorder.recordedBlob && !analyzing && (
            <>
              <div style={{ fontSize: 13, color: "#4ade80", marginBottom: 10, fontWeight: 600 }}>✓ Recording complete</div>
              <Wave active={false} color="#4ade80" />
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
                <button style={{ ...btn("ghost"), fontSize: 12 }} onClick={() => usrPlayer.play(recorder.recordedBlob!)}>
                  {usrPlayer.playing ? "▶ Playing..." : "▶ Play My Recording"}
                </button>
                <button style={btn("ghost")} onClick={resetRec}>🔄 Re-record</button>
                <button style={btn("pri")} onClick={doAnalysis}>🤖 Analyze →</button>
              </div>
              {analyzeError && <div style={{ marginTop: 12, fontSize: 12, color: "#f87171" }}>{analyzeError}</div>}
            </>
          )}
          {analyzing && (
            <div style={{ padding: "18px 0" }}>
              <div style={{ fontSize: 14, color: "#93c5fd", marginBottom: 14 }}>🔬 Analyzing synchronization...</div>
              {["Decoding reference & recording", "Extracting pitch & energy features", "Running DTW alignment", "Scoring timing & rhythm accuracy"].map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "#64748b", marginBottom: 6, justifyContent: "center" }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#4f46e5" }} />
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
        {(recorder.recording || recorder.recordedBlob) && (
          <div style={card}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Reference Text</div>
            {poem.lines.map((line, i) => (
              <div key={i} style={{ padding: "6px 0", borderBottom: i < poem.lines.length - 1 ? "1px solid #1e293b" : "none" }}>
                <div style={{ fontSize: 14, color: "#94a3b8" }}>{line.tel}</div>
                <div style={{ fontSize: 10, color: "#475569", fontStyle: "italic" }}>{line.en}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.93)}}`}</style>
    </div>
  );

  // ══ RESULTS ═════════════════════════════════════════════════════════════════
  if (view === "results" && analysis && poem) {
    const { sync, timing, rhythm, final, lyricsScore, transcript, wordDiffResult, lineResults, tips, refWave, usrWave } = analysis;
    const sc = { perfect: { c: "#4ade80", bg: "#0f2318" }, good: { c: "#86efac", bg: "#0f2318" }, warning: { c: "#fbbf24", bg: "#1a1400" }, error: { c: "#f87171", bg: "#1a0000" } };
    return (
      <div style={{ minHeight: "100vh", background: BG, color: "#e2e8f0", fontFamily: "'Segoe UI',sans-serif" }}>
        <div style={hdr}>
          <button style={{ ...btn("ghost"), padding: "4px 10px", fontSize: 12 }} onClick={() => { resetRec(); setView("practice"); }}>← Try Again</button>
          <span style={{ fontSize: 12, color: "#64748b" }}>Results — Poem {poem.num}</span>
          <button style={{ ...btn("ghost"), padding: "4px 10px", fontSize: 12 }} onClick={() => setView("home")}>All Poems</button>
        </div>
        <div style={W}>
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{poem.src} · Poem {poem.num}</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>{poem.title}</h2>
          </div>
          <div style={{ ...card, background: "linear-gradient(135deg,#0f172a,#1e1b4b)", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", flexWrap: "wrap", gap: 16, marginBottom: 14 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 54, fontWeight: 900, lineHeight: 1, background: final >= 85 ? "linear-gradient(135deg,#22c55e,#16a34a)" : final >= 65 ? "linear-gradient(135deg,#f59e0b,#d97706)" : "linear-gradient(135deg,#ef4444,#dc2626)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{final}%</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Overall Sync Score</div>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
                {lyricsScore !== null && <Gauge score={lyricsScore} label="Lyrics" />}
                <Gauge score={sync} label="Sync" /><Gauge score={timing} label="Timing" /><Gauge score={rhythm} label="Rhythm" />
              </div>
            </div>
            <div style={{ textAlign: "center", fontSize: 13, fontWeight: 600, color: final >= 85 ? "#4ade80" : final >= 65 ? "#fbbf24" : "#f87171" }}>
              {final >= 85 ? "🌟 Excellent! You are event-ready." : final >= 65 ? "👍 Good! A bit more practice will perfect it." : "💪 Keep practicing — focus on the lines below."}
            </div>
            {lyricsScore === null && (
              <div style={{ textAlign: "center", fontSize: 11, color: "#64748b", marginTop: 8 }}>
                ⓘ Lyrics content check unavailable for this recording — score reflects timing/rhythm only.
              </div>
            )}
          </div>
          <div style={{ ...card, marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Summary</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(155px,1fr))", gap: 8 }}>
              {[
                ...(lyricsScore !== null ? [[lyricsScore >= 70, "Lyrics", "✓ Words matched", "⚠ Words mismatched"] as const] : []),
                [rhythm >= 78, "Rhythm", "✓ Matched", "⚠ Needs Work"], [timing >= 78, "Timing", "✓ On beat", "⚠ Off beat"],
              [sync >= 78, "Sync", "✓ In sync", "⚠ Sync issues"],
              [lineResults.filter(l => l.status === "perfect").length >= lineResults.length / 2,
              `${lineResults.filter(l => l.status === "perfect").length}/${lineResults.length} Lines`, "✓ Perfect", "⚠ Mixed"]
              ].map(([ok, lbl, yes, no], i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: ok ? "#0f2318" : "#1a1400", border: `1px solid ${ok ? "#166534" : "#713f12"}`, borderRadius: 8, padding: "7px 10px" }}>
                  <span style={{ color: ok ? "#4ade80" : "#fbbf24", fontSize: 13 }}>{ok ? "✓" : "⚠"}</span>
                  <div><div style={{ fontSize: 10, color: ok ? "#4ade80" : "#fbbf24", fontWeight: 700 }}>{lbl}</div><div style={{ fontSize: 10, color: "#94a3b8" }}>{ok ? yes : no}</div></div>
                </div>
              ))}
            </div>
          </div>
          {transcript.trim() && (
            <div style={{ ...card, marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Word-by-Word Check</div>
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span><span style={{ color: "#4ade80" }}>●</span> Correct</span>
                <span><span style={{ color: "#fbbf24" }}>●</span> Mispronounced</span>
                <span><span style={{ color: "#f87171" }}>●</span> Missed</span>
              </div>
              {wordDiffResult.length > 0 ? (
                <div style={{ lineHeight: 2.2, fontSize: 15 }}>
                  {wordDiffResult.map((item, idx) => {
                    const clr = item.status === "correct" ? "#4ade80" : item.status === "wrong" ? "#fbbf24" : "#f87171";
                    const bg  = item.status === "correct" ? "#0f231822" : item.status === "wrong" ? "#1a140022" : "#1a000022";
                    return (
                      <span key={idx} title={item.status} style={{
                        display: "inline-block", margin: "2px 4px",
                        padding: "1px 7px", borderRadius: 5,
                        background: bg, border: `1px solid ${clr}55`,
                        color: clr, fontWeight: item.status !== "correct" ? 700 : 400,
                      }}>
                        {item.word}
                        {item.status === "missed" && <span style={{ fontSize: 9, marginLeft: 3, opacity: 0.7 }}>✗</span>}
                        {item.status === "wrong"  && <span style={{ fontSize: 9, marginLeft: 3, opacity: 0.7 }}>~</span>}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7 }}>{transcript}</div>
              )}
              <div style={{ fontSize: 11, color: "#475569", marginTop: 10, borderTop: "1px solid #1e293b", paddingTop: 8 }}>
                Raw transcript: <span style={{ color: "#64748b" }}>{transcript}</span>
              </div>
            </div>
          )}
          <div style={{ ...card, marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Line-by-Line Feedback</div>
            {lineResults.map((lr, i) => (
              <div key={i} style={{ background: sc[lr.status].bg, border: `1px solid ${sc[lr.status].c}22`, borderLeft: `3px solid ${sc[lr.status].c}`, borderRadius: 8, padding: "9px 12px", marginBottom: 7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#475569", marginBottom: 2 }}>Line {i + 1}</div>
                    <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 3 }}>{poem.lines[i]?.tel}</div>
                    <div style={{ fontSize: 11, color: sc[lr.status].c, fontWeight: 600 }}>{lr.feedback}</div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 10, color: "#64748b", flexShrink: 0 }}>
                    {lr.off !== 0 && <div>Offset: {lr.off > 0 ? "+" : ""}{lr.off}s</div>}
                    <div>Tempo: {Math.round(lr.tempo * 100)}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {tips.length > 0 && (
            <div style={{ ...card, marginBottom: 14, background: "#0c1a0a", border: "1px solid #166534" }}>
              <div style={{ fontSize: 10, color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>💡 Improvement Tips</div>
              {tips.map((t, i) => <div key={i} style={{ fontSize: 12, color: "#86efac", marginBottom: 5, display: "flex", gap: 8 }}><span>→</span><span>{t}</span></div>)}
            </div>
          )}
          {/* Waveform comparison — now uses REAL decoded audio data, each playable */}
          <div style={{ ...card, marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Waveform Comparison</div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#4f46e5", fontWeight: 700 }}>Reference</span>
                <button style={{ ...btn("ghost"), padding: "2px 10px", fontSize: 10 }} onClick={refPlayer.playing ? refPlayer.stop : playReferenceSegment}>
                  {refPlayer.playing ? "⏹ Stop" : "▶ Play"}
                </button>
              </div>
              <StaticWave data={refWave} color="#4f46e5" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: final >= 70 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>Your Voice</span>
                <button style={{ ...btn("ghost"), padding: "2px 10px", fontSize: 10 }}
                  onClick={() => { if (usrPlayer.playing) { usrPlayer.stop(); } else if (recorder.recordedBlob) { refPlayer.stop(); usrPlayer.play(recorder.recordedBlob); } }}>
                  {usrPlayer.playing ? "⏹ Stop" : "▶ Play"}
                </button>
              </div>
              <StaticWave data={usrWave} color={final >= 70 ? "#22c55e" : "#ef4444"} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button style={btn("ghost")} onClick={() => { resetRec(); setView("record"); }}>🔄 Try Again</button>
            <button style={btn("pri")} onClick={() => { resetRec(); setView("home"); }}>📚 Next Poem</button>
          </div>
        </div>
      </div>
    );
  }

  // ══ ADMIN ════════════════════════════════════════════════════════════════════
  // Removed: admin functionality now lives at the server-rendered, role-gated
  // /admin route (see app/admin/page.tsx), reached via the "⚙ Admin" link in
  // the home header (only shown to users whose profiles.role is 'admin').
  // The old version here was just a client-side `view==="admin"` screen gated
  // by a hardcoded password shipped in the JS bundle — visible to anyone via
  // devtools, and not actually separated from normal users at all.

  return null;
}
