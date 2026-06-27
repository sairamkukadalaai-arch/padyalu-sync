"use client";

import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface UserRow {
  id: string;
  username: string;
  role: string;
  created_at: string;
}

export default function UserManager() {
  const supabase = useRef(createClient());
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const flash = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 3) return;
    setSearching(true);
    setSearched(true);
    cancelEdit();
    const { data } = await supabase.current
      .from("profiles")
      .select("id, username, role, created_at")
      .ilike("username", `%${q.trim()}%`)
      .order("username");
    setUsers((data ?? []) as UserRow[]);
    setSearching(false);
  }, []);

  const refreshSearch = () => search(query);

  const createUser = async () => {
    if (!newUsername.trim() || newPassword.length < 6) {
      flash("Username required and password must be ≥ 6 chars.", false); return;
    }
    setCreating(true);
    const r = await fetch("/api/admin/create-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername.trim(), password: newPassword }),
    });
    const d = await r.json();
    if (!r.ok) { flash(`Create failed: ${d.error}`, false); }
    else {
      flash(`User "${newUsername.trim()}" created.`, true);
      setNewUsername(""); setNewPassword("");
      // If current search would match the new user, refresh results
      if (newUsername.trim().toLowerCase().includes(query.trim().toLowerCase()) && query.trim().length >= 3) {
        await search(query);
      }
    }
    setCreating(false);
  };

  const startEdit = (u: UserRow) => { setEditId(u.id); setEditUsername(u.username); setEditPassword(""); setMsg(null); };
  const cancelEdit = () => { setEditId(null); setEditUsername(""); setEditPassword(""); };

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    if (editUsername.trim()) {
      const { error } = await supabase.current.from("profiles").update({ username: editUsername.trim() }).eq("id", editId);
      if (error) { flash(`Update failed: ${error.message}`, false); setSaving(false); return; }
    }
    if (editPassword.length >= 6) {
      const r = await fetch("/api/admin/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: editId, password: editPassword }),
      });
      if (!r.ok) { const d = await r.json(); flash(`Password update failed: ${d.error}`, false); setSaving(false); return; }
    }
    flash("User updated.", true);
    cancelEdit();
    await refreshSearch();
    setSaving(false);
  };

  const deleteUser = async (u: UserRow) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    const r = await fetch("/api/admin/delete-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: u.id }),
    });
    if (!r.ok) { const d = await r.json(); flash(`Delete failed: ${d.error}`, false); }
    else { flash(`User "${u.username}" deleted.`, true); await refreshSearch(); }
  };

  const inp: React.CSSProperties = {
    background: "#0f172a", border: "1px solid #334155", borderRadius: 6,
    color: "#e2e8f0", padding: "6px 10px", fontSize: 12, fontFamily: "inherit", flex: 1, minWidth: 0,
  };
  const btnStyle = (v: "ok" | "warn" | "ghost" | "danger"): React.CSSProperties => {
    const vs = {
      ok:     { background: "#059669", color: "white", border: "none" },
      warn:   { background: "#d97706", color: "white", border: "none" },
      ghost:  { background: "transparent", color: "#94a3b8", border: "1px solid #334155" },
      danger: { background: "#991b1b", color: "white", border: "none" },
    };
    return { ...vs[v], padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap" };
  };

  return (
    <div>
      {msg && (
        <div style={{ fontSize: 12, color: msg.ok ? "#4ade80" : "#f87171", background: msg.ok ? "#0f2318" : "#1a0000", border: `1px solid ${msg.ok ? "#166534" : "#7f1d1d"}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          {msg.ok ? "✓" : "✗"} {msg.text}
        </div>
      )}

      {/* Create new user */}
      <div style={{ background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 10 }}>Create New User</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={inp} placeholder="Username" value={newUsername} onChange={e => setNewUsername(e.target.value)} />
          <input style={inp} placeholder="Password (min 6 chars)" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          <button style={btnStyle("ok")} onClick={createUser} disabled={creating}>{creating ? "Creating…" : "+ Create"}</button>
        </div>
      </div>

      {/* Search */}
      <div style={{ background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 10, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 10 }}>Search Users</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inp, flex: 1 }}
            placeholder="Type at least 3 characters…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search(query)}
          />
          <button
            style={{ ...btnStyle("ok"), opacity: query.trim().length < 3 ? 0.4 : 1 }}
            onClick={() => search(query)}
            disabled={query.trim().length < 3 || searching}
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {query.trim().length > 0 && query.trim().length < 3 && (
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>Type at least 3 characters to search.</div>
        )}
      </div>

      {/* Results */}
      {searched && !searching && (
        users.length === 0 ? (
          <div style={{ fontSize: 12, color: "#64748b", padding: "10px 0" }}>No users found matching "{query}".</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 2 }}>{users.length} result{users.length !== 1 ? "s" : ""}</div>
            {users.map(u => (
              <div key={u.id} style={{ background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 10, padding: 12 }}>
                {editId === u.id ? (
                  <div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <input style={inp} placeholder="New username" value={editUsername} onChange={e => setEditUsername(e.target.value)} />
                      <input style={inp} placeholder="New password (leave blank to keep)" type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={btnStyle("ok")} onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "✓ Save"}</button>
                      <button style={btnStyle("ghost")} onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{u.username}</span>
                      {u.role === "admin" && <span style={{ fontSize: 10, color: "#f59e0b", marginLeft: 8, fontWeight: 700 }}>ADMIN</span>}
                      <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Joined {new Date(u.created_at).toLocaleDateString("en-IN")}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button style={btnStyle("warn")} onClick={() => startEdit(u)}>✏ Edit</button>
                      {u.role !== "admin" && <button style={btnStyle("danger")} onClick={() => deleteUser(u)}>✕ Delete</button>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
