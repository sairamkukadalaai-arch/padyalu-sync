import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ALL_POEMS } from "@/lib/poems";
import ClipManager from "./ClipManager";
import UserManager from "./UserManager";

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

  // Use service role for admin data queries — bypasses RLS to reliably fetch
  // all rows. The admin gate above already ensures only admins reach this point.
  const svc = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const [{ data: profiles }, { data: attempts }, { data: suggestions }] = await Promise.all([
    svc.from("profiles").select("id, username, role, created_at").order("created_at", { ascending: true }).range(0, 9999),
    svc.from("attempts").select("user_id, poem_id, final_score, sync_score, timing_score, rhythm_score, lyrics_score, created_at").range(0, 999999),
    svc.from("suggestions").select("id, user_id, poem_id, message, created_at").order("created_at", { ascending: false }).range(0, 9999),
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

  // Users who have attempted at least one poem
  const activeRows = rows.filter((r) => r.poemsDone > 0);

  // Leaderboard helpers
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentAttempts = allAttempts.filter((a) => a.created_at >= oneWeekAgo);

  // Top 5 by poems completed (distinct poems per user)
  function topByPoemsCompleted(attemptList: AttemptRow[], n = 5) {
    const byUser = new Map<string, Set<string>>();
    for (const a of attemptList) {
      if (!byUser.has(a.user_id)) byUser.set(a.user_id, new Set());
      byUser.get(a.user_id)!.add(a.poem_id);
    }
    return Array.from(byUser.entries())
      .map(([uid, poems]) => ({ username: usernameById.get(uid) ?? "Unknown", value: poems.size }))
      .sort((a, b) => b.value - a.value)
      .slice(0, n);
  }

  // Top 5 by max score in any single attempt
  function topByMaxScore(attemptList: AttemptRow[], n = 5) {
    const byUser = new Map<string, number>();
    for (const a of attemptList) {
      byUser.set(a.user_id, Math.max(byUser.get(a.user_id) ?? 0, a.final_score));
    }
    return Array.from(byUser.entries())
      .map(([uid, value]) => ({ username: usernameById.get(uid) ?? "Unknown", value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, n);
  }

  // Top 5 by average score across all their attempts (unique poems best score)
  function topByAvgScore(attemptList: AttemptRow[], n = 5) {
    const byUser = new Map<string, Map<string, number>>();
    for (const a of attemptList) {
      if (!byUser.has(a.user_id)) byUser.set(a.user_id, new Map());
      const m = byUser.get(a.user_id)!;
      m.set(a.poem_id, Math.max(m.get(a.poem_id) ?? 0, a.final_score));
    }
    return Array.from(byUser.entries())
      .map(([uid, poems]) => {
        const scores = Array.from(poems.values());
        const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
        return { username: usernameById.get(uid) ?? "Unknown", poems: scores.length, value: avg };
      })
      .sort((a, b) => b.value - a.value || b.poems - a.poems)
      .slice(0, n);
  }

  const leaderboards = {
    poemsWeek: topByPoemsCompleted(recentAttempts),
    poemsAll: topByPoemsCompleted(allAttempts),
    maxWeek: topByMaxScore(recentAttempts),
    maxAll: topByMaxScore(allAttempts),
    avgWeek: topByAvgScore(recentAttempts),
    avgAll: topByAvgScore(allAttempts),
  };

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
          Signed in as <strong>{usernameById.get(user.id) ?? user.email}</strong> · <strong>{activeRows.length}</strong> user{activeRows.length === 1 ? "" : "s"} practiced at least one poem
        </div>

        {/* ── Leaderboard Analytics ─────────────────────────────────────────── */}
        <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginBottom: 10 }}>Leaderboard Analytics</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", gap: 14, marginBottom: 20 }}>
          {([
            { title: "# Poems Completed · Last 7 Days",  rows: leaderboards.poemsWeek, col: "Poems",   fmt: (r: {username:string;value:number}) => `${r.value}` },
            { title: "# Poems Completed · All Time",      rows: leaderboards.poemsAll,  col: "Poems",   fmt: (r: {username:string;value:number}) => `${r.value}` },
            { title: "Max % Scored · Last 7 Days",        rows: leaderboards.maxWeek,   col: "Score",   fmt: (r: {username:string;value:number}) => `${r.value}%` },
            { title: "Max % Scored · All Time",           rows: leaderboards.maxAll,    col: "Score",   fmt: (r: {username:string;value:number}) => `${r.value}%` },
            { title: "Average Score · Last 7 Days",       rows: leaderboards.avgWeek,   col: "Avg",     fmt: (r: {username:string;value:number;poems?:number}) => `${r.poems} poems · ${r.value}%` },
            { title: "Average Score · All Time",          rows: leaderboards.avgAll,    col: "Avg",     fmt: (r: {username:string;value:number;poems?:number}) => `${r.poems} poems · ${r.value}%` },
          ] as const).map(({ title, rows, col, fmt }) => (
            <div key={title} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>{title}</div>
              {rows.length === 0 ? (
                <div style={{ fontSize: 12, color: "#475569" }}>No data yet.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: "#475569", fontSize: 10, textTransform: "uppercase" }}>
                      <th style={{ textAlign: "left", padding: "3px 6px", width: 20 }}>#</th>
                      <th style={{ textAlign: "left", padding: "3px 6px" }}>Name</th>
                      <th style={{ textAlign: "right", padding: "3px 6px" }}>{col}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rows as {username:string;value:number;poems?:number}[]).map((r, i) => (
                      <tr key={r.username} style={{ borderTop: "1px solid #1e293b" }}>
                        <td style={{ padding: "5px 6px", color: i === 0 ? "#f59e0b" : "#475569", fontWeight: 700 }}>{i + 1}</td>
                        <td style={{ padding: "5px 6px", color: "#e2e8f0", fontWeight: i === 0 ? 700 : 400 }}>{r.username}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: "#38bdf8", fontWeight: 600 }}>{fmt(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>

        {/* ── User Progress ─────────────────────────────────────────────────── */}
        <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginBottom: 10 }}>User Progress</div>
        <div style={card}>
          {activeRows.length === 0 ? (
            <p style={{ fontSize: 12, color: "#64748b" }}>No one has practiced yet.</p>
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
                  {activeRows.map((r) => (
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

        <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9", marginBottom: 10 }}>User Management</div>
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 18, marginBottom: 16 }}>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>
            Create accounts for participants, update usernames/passwords, or remove users. Admin accounts cannot be deleted here.
          </p>
          <UserManager />
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
