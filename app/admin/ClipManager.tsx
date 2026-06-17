"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ALL_POEMS, type Poem } from "@/lib/poems";

interface ClipRow {
  poem_id: string;
  storage_path: string;
  start_sec: number;
  end_sec: number;
}

export default function ClipManager({ adminId }: { adminId: string }) {
  const supabase = useRef(createClient());
  const [clips, setClips] = useState<Record<string, ClipRow>>({});
  const [active, setActive] = useState<string | null>(null); // poem_id being edited
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase.current.from("reference_clips").select("*").then(({ data }) => {
      if (data) setClips(Object.fromEntries((data as ClipRow[]).map(r => [r.poem_id, r])));
    });
  }, []);

  const openPoem = (p: Poem) => {
    setActive(p.id);
    setFile(null);
    setAudioUrl(null);
    setDuration(0);
    setStartSec(0);
    setEndSec(0);
    setMsg(null);
    stopPreview();

    const existing = clips[p.id];
    if (existing) {
      const { data: { publicUrl } } = supabase.current.storage
        .from("reference-audio").getPublicUrl(existing.storage_path);
      setAudioUrl(publicUrl);
      setStartSec(existing.start_sec);
      setEndSec(existing.end_sec);
      const a = new Audio(publicUrl);
      a.onloadedmetadata = () => { setDuration(a.duration); };
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setAudioUrl(url);
    const a = new Audio(url);
    a.onloadedmetadata = () => {
      setDuration(a.duration);
      setStartSec(0);
      setEndSec(a.duration);
    };
  };

  const upload = async (poemId: string) => {
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "mp3";
    const path = `poems/${poemId}.${ext}`;
    const { error } = await supabase.current.storage
      .from("reference-audio")
      .upload(path, file, { upsert: true });
    setUploading(false);
    if (error) { setMsg({ text: `Upload failed: ${error.message}`, ok: false }); return null; }
    return path;
  };

  const save = async () => {
    if (!active || !audioUrl) return;
    setSaving(true);
    setMsg(null);
    let path = clips[active]?.storage_path ?? null;

    if (file) {
      const uploaded = await upload(active);
      if (!uploaded) { setSaving(false); return; }
      path = uploaded;
    }

    if (!path) { setMsg({ text: "Please upload an audio file first.", ok: false }); setSaving(false); return; }

    const row = {
      poem_id: active,
      storage_path: path,
      start_sec: startSec,
      end_sec: endSec,
      uploaded_by: adminId,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.current
      .from("reference_clips")
      .upsert(row, { onConflict: "poem_id" });

    if (error) { setMsg({ text: `Save failed: ${error.message}`, ok: false }); }
    else {
      setClips(prev => ({ ...prev, [active]: { ...row } as ClipRow }));
      setFile(null);
      setMsg({ text: "Saved!", ok: true });
    }
    setSaving(false);
  };

  const stopPreview = useCallback(() => {
    if (previewStopRef.current) { clearTimeout(previewStopRef.current); previewStopRef.current = null; }
    audioRef.current?.pause();
    setPreviewPlaying(false);
  }, []);

  const playPreview = () => {
    if (!audioUrl) return;
    stopPreview();
    const a = new Audio(audioUrl);
    a.currentTime = startSec;
    a.play().then(() => {
      setPreviewPlaying(true);
      audioRef.current = a;
      const dur = (endSec - startSec) * 1000;
      previewStopRef.current = setTimeout(() => { a.pause(); setPreviewPlaying(false); }, dur);
      a.onended = () => setPreviewPlaying(false);
    });
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

  const inp: React.CSSProperties = { background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "6px 10px", fontSize: 12, fontFamily: "inherit", width: "100%" };
  const btn = (v: "pri" | "ok" | "ghost" | "warn"): React.CSSProperties => {
    const vs = {
      pri:   { background: "#4f46e5", color: "white", border: "none" },
      ok:    { background: "#059669", color: "white", border: "none" },
      warn:  { background: "#d97706", color: "white", border: "none" },
      ghost: { background: "transparent", color: "#94a3b8", border: "1px solid #334155" },
    };
    return { ...vs[v], padding: "7px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 };
  };

  const activePoem = active ? ALL_POEMS.find(p => p.id === active) : null;

  return (
    <div>
      {/* ── POEM GRID ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 8, marginBottom: 20 }}>
        {ALL_POEMS.map(p => {
          const has = !!clips[p.id];
          const isActive = active === p.id;
          return (
            <div key={p.id} onClick={() => openPoem(p)} style={{
              background: isActive ? "#1e1b4b" : has ? "#0c1a0a" : "#0f172a",
              border: `1px solid ${isActive ? "#6366f1" : has ? "#166534" : "#334155"}`,
              borderRadius: 8, padding: "10px 12px", cursor: "pointer",
              transition: "all 0.15s",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: has ? "#4ade80" : "#64748b" }}>
                  {has ? "✓ Uploaded" : "⬆ Upload"}
                </span>
                <span style={{ fontSize: 11, color: "#475569" }}>P{p.num}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.3 }}>{p.title}</div>
              {has && (
                <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>
                  {fmt(clips[p.id].start_sec)} – {fmt(clips[p.id].end_sec)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── EDITOR PANEL ── */}
      {activePoem && (
        <div style={{ background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", marginBottom: 12 }}>
            Poem {activePoem.num} — {activePoem.title}
          </div>

          {/* File upload */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 6 }}>
              {clips[active!] ? "Replace audio file (optional):" : "Upload audio file:"}
            </label>
            <input type="file" accept="audio/*" onChange={onFileChange} style={inp} />
          </div>

          {/* Trim sliders — only show when we have audio */}
          {audioUrl && duration > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
                Trim — Start: <strong style={{ color: "#93c5fd" }}>{fmt(startSec)}</strong> &nbsp; End: <strong style={{ color: "#93c5fd" }}>{fmt(endSec)}</strong> &nbsp; Duration: <strong style={{ color: "#4ade80" }}>{fmt(endSec - startSec)}</strong>
              </div>

              {/* Start slider */}
              <label style={{ fontSize: 10, color: "#475569", display: "block", marginBottom: 4 }}>Start (s)</label>
              <input type="range" min={0} max={duration} step={0.1} value={startSec}
                onChange={e => { const v = parseFloat(e.target.value); if (v < endSec) setStartSec(v); }}
                style={{ width: "100%", accentColor: "#6366f1", marginBottom: 10 }} />

              {/* End slider */}
              <label style={{ fontSize: 10, color: "#475569", display: "block", marginBottom: 4 }}>End (s)</label>
              <input type="range" min={0} max={duration} step={0.1} value={endSec}
                onChange={e => { const v = parseFloat(e.target.value); if (v > startSec) setEndSec(v); }}
                style={{ width: "100%", accentColor: "#6366f1", marginBottom: 10 }} />

              {/* Timeline visual */}
              <div style={{ position: "relative", height: 10, background: "#1e293b", borderRadius: 5, marginBottom: 12, overflow: "hidden" }}>
                <div style={{
                  position: "absolute", top: 0, bottom: 0, borderRadius: 5,
                  left: `${(startSec / duration) * 100}%`,
                  width: `${((endSec - startSec) / duration) * 100}%`,
                  background: "linear-gradient(90deg,#4f46e5,#7c3aed)"
                }} />
              </div>

              <button style={btn(previewPlaying ? "warn" : "ok")} onClick={previewPlaying ? stopPreview : playPreview}>
                {previewPlaying ? "⏹ Stop Preview" : "▶ Preview Trim"}
              </button>
            </div>
          )}

          {msg && (
            <div style={{ fontSize: 12, color: msg.ok ? "#4ade80" : "#f87171", marginBottom: 10 }}>
              {msg.ok ? "✓" : "✗"} {msg.text}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn("pri")} onClick={save} disabled={uploading || saving}>
              {uploading ? "Uploading…" : saving ? "Saving…" : "💾 Save Clip"}
            </button>
            <button style={btn("ghost")} onClick={() => { setActive(null); stopPreview(); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
