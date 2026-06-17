import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ALL_POEMS } from "@/lib/poems";
import ClipManager from "./ClipManager";

// ════════════════════════════════════════════════════════════════════════════
// /admin — server-rendered, role-gated dashboard.
//
// Unlike the old client-side admin screen (gated by a hardcoded password
// visible in devtools), access here is enforced server-side: this component
// reads the logged-in user's `role` from the `profiles` table via the
// server Supabase client, and redirects anyone who isn't an admin. The actual
// data queries also go through Supabase Row Level Security (see
// supabase/schema.sql) — a non-admin querying these tables directly would
// only ever get their own rows back, so this page's gating is a UX
// convenience on top of a real security boundary, not the only thing
// stopping a normal user from seeing everyone's data.
// ════════════════════════════════════════════════════════════════════════════

interface AttemptRow {
  user_id: string;
  poem_id: string;
  final_score: number;
  sync_score: number;
  timing_score: number;
  rhythm_score: number;
  lyrics_score: number | null;
  created_at: string;
}

interface SuggestionRow {
  id: number;
  user_id: string;
  poem_id: string | null;
  message: string;
  created_at: string;
}

interface ProfileRow {
  id: string;
  username: string;
  role: string;
  created_at: string;
}

const POEM_TITLE: Record<string, string> = Object.fromEntries(
  ALL_POEMS.map((p) => [p.id, `${p.num}. ${p.title}`])
);
const TOTAL_POEMS = ALL_POEMS.length;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function AdminPage() {
  const supabase = await createClient();

  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user) redirect("/login");

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!myProfile || myProfile.role !== "admin") redirect("/");

  const [{ data: profiles }, { data: attempts }, { data: suggestions }] = await Promise.all([
    supabase.from("profiles").select("id, username, role, created_at").order("created_at", { ascending: true }),
    supabase.from("attempts").select("user_id, poem_id, final_score, sync_score, timing_score, rhythm_score, lyrics_score, created_at"),
    supabase.from("suggestions").select("id, user_id, poem_id, message, created_at").order("created_at", { ascending: false }),
  ]);

  const allProfiles = (profiles ?? []) as ProfileRow[];
  const allAttempts = (attempts ?? []) as AttemptRow[];
  const allSuggestions = (suggestions ?? []) as SuggestionRow[];

  const usernameById = new Map(allProfiles.map((p) => [p.id, p.username]));

  // Best score per (user, poem), reduced from the full attempt history.
  const bestByUserPoem = new Map<string, Map<string, number>>();
  const lastActivityByUser = new Map<string, string>();
  for (const a of allAttempts) {
    if (!bestByUserPoem.has(a.user_id)) bestByUserPoem.set(a.user_id, new Map());
    const m = bestByUserPoem.get(a.user_id)!;
    m.set(a.poem_id, Math.max(m.get(a.poem_id) ?? 0, a.final_score));
    const prevLatest = lastActivityByUser.get(a.user_id);
    if (!prevLatest || a.created_at > prevLatest) lastActivityByUser.set(a.user_id, a.created_at);
  }

  const rows = allProfiles
    .filter((p) => p.role !== "admin")
    .map((p) => {
      const best = bestByUserPoem.get(p.id);
      const poemsDone = best ? best.size : 0;
      const avg = best && best.size > 0
        ? Math.round(Array.from(best.values()).reduce((s, v) => s + v, 0) / best.size)
        : null;
      return {
        id: p.id,
        username: p.username,
        poemsDone,
        avg,
        lastActivity: lastActivityByUser.get(p.id) ?? null,
        joined: p.created_at,
      };
    })
    .sort((a, b) => b.poemsDone - a.poemsDone);

  const BG = "#030712";
  const card: React.CSSProperties = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 18, marginBottom: 16 };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: "#e2e8f0", fontFamily: "'Segoe UI',sans-serif" }}>
      <div style={{
        background: "linear-gradient(135deg,#0f172a,#1e1b4b,#0f172a)", borderBottom: "1px solid #1e293b",
        padding: "0 16px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <Link href="/" style={{ color: "#94a3b8", fontSize: 12, textDecoration: "none", border: "1px solid #334155", borderRadius: 8, padding: "5px 12px" }}>← Home</Link>
        <span style={{ fontSize: 13, color: "#f59e0b", fontWeight: 700 }}>⚙ Admin Dashboard</span>
        <div style={{ width: 64 }} />
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "20px 14px" }}>
        <div style={{ background: "#1a0800", border: "1px solid #92400e", borderRadius: 10, padding: "10px 14px", marginBottom: 18, fontSize: 12, color: "#fbbf24" }}>
          Signed in as <strong>{usernameById.get(user.id) ?? user.email}</strong> · {rows.length} non-admin user{rows.length === 1 ? "" : "s"} · {allAttempts.length} total attempts logged
        </div>

        <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginBottom: 10 }}>User Progress</div>
        <div style={card}>
          {rows.length === 0 ? (
            <p style={{ fontSize: 12, color: "#64748b" }}>No users have signed up yet (besides you).</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <th style={{ padding: "6px 10px" }}>Username</th>
                    <th style={{ padding: "6px 10px" }}>Progress</th>
                    <th style={{ padding: "6px 10px" }}>Avg Best Score</th>
                    <th style={{ padding: "6px 10px" }}>Last Activity</th>
                    <th style={{ padding: "6px 10px" }}>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid #1e293b" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600, color: "#e2e8f0" }}>{r.username}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{
                          background: r.poemsDone === TOTAL_POEMS ? "#166534" : "#1e293b",
                          color: r.poemsDone === TOTAL_POEMS ? "#4ade80" : "#93c5fd",
                          padding: "2px 8px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                        }}>{r.poemsDone}/{TOTAL_POEMS}</span>
                      </td>
                      <td style={{ padding: "8px 10px", color: r.avg === null ? "#475569" : r.avg >= 85 ? "#4ade80" : r.avg >= 65 ? "#93c5fd" : "#fca5a5" }}>
                        {r.avg === null ? "—" : `${r.avg}%`}
                      </td>
                      <td style={{ padding: "8px 10px", color: "#94a3b8" }}>{r.lastActivity ? fmtDate(r.lastActivity) : "—"}</td>
                      <td style={{ padding: "8px 10px", color: "#475569" }}>{fmtDate(r.joined)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginBottom: 10 }}>Suggestions ({allSuggestions.length})</div>
        <div style={card}>
          {allSuggestions.length === 0 ? (
            <p style={{ fontSize: 12, color: "#64748b" }}>No suggestions submitted yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {allSuggestions.map((s) => (
                <div key={s.id} style={{ background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11, color: "#64748b" }}>
                    <span><strong style={{ color: "#93c5fd" }}>{usernameById.get(s.user_id) ?? "Unknown"}</strong>{s.poem_id ? ` · ${POEM_TITLE[s.poem_id] ?? s.poem_id}` : " · General"}</span>
                    <span>{fmtDate(s.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.5 }}>{s.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginBottom: 10 }}>Reference Audio Clips</div>
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 18, marginBottom: 16 }}>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>
            Upload a reference recording for each poem. Students hear this when they tap Play Reference.
            After uploading, drag the trim sliders to select the exact section, then save.
          </p>
          <ClipManager adminId={user.id} />
        </div>

        <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.7 }}>
          To promote another user to admin, run in the Supabase SQL editor:
          <br />
          <code style={{ color: "#93c5fd" }}>update public.profiles set role = &apos;admin&apos; where username = &apos;their_username&apos;;</code>
        </div>
      </div>
    </div>
  );
}
