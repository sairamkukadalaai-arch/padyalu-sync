"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Supabase Auth only speaks "email + password" — we give the user a plain
// username/password experience by deterministically mapping their username
// to a fake, never-emailed-to address. Uniqueness of this address (which
// Supabase enforces) is exactly uniqueness of the username.
function usernameToEmail(username: string) {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  return `${clean}@padyalu.local`;
}

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const validUsername = /^[a-zA-Z0-9_.-]{3,24}$/.test(username.trim());

  const submit = async () => {
    setError("");
    if (!validUsername) {
      setError("Username must be 3-24 characters: letters, numbers, _ . -");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const email = usernameToEmail(username);

    try {
      if (mode === "signup") {
        const { error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: username.trim() } },
        });
        if (signUpErr) {
          if (signUpErr.message.toLowerCase().includes("already registered")) {
            setError("That username is already taken.");
          } else {
            setError(signUpErr.message);
          }
          setBusy(false);
          return;
        }
        // If "Confirm email" is on in the Supabase project, signUp won't
        // return a session — fall through and try signing in directly,
        // which works because these synthetic addresses are never confirmed
        // via email anyway (see SETUP.md: turn email confirmation off).
      }

      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) {
        setError(
          mode === "signup"
            ? "Account created, but auto-login failed — check that email confirmation is disabled in Supabase, then sign in manually."
            : "Incorrect username or password."
        );
        setBusy(false);
        return;
      }
      // Hard navigation so the browser sends the fresh auth cookies on the
      // next request — soft router.push() can race the cookie write and leave
      // the middleware seeing no session, looping back to /login.
      window.location.href = "/";
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  const input: React.CSSProperties = {
    width: "100%", padding: "11px 14px", background: "#0f172a", border: "1px solid #334155",
    borderRadius: 8, color: "white", fontSize: 14, marginBottom: 12, boxSizing: "border-box",
    outline: "none", fontFamily: "inherit",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#030712", color: "#e2e8f0", fontFamily: "'Segoe UI',sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 6 }}>📜</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>పద్యాల సంఖారవం</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Padyalu Sync — practice tracker</div>
        </div>

        <div style={{ display: "flex", marginBottom: 18, background: "#0f172a", borderRadius: 8, padding: 3 }}>
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                background: mode === m ? "#4f46e5" : "transparent",
                color: mode === m ? "white" : "#94a3b8",
              }}
            >
              {m === "signin" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        <input style={input} placeholder="Username" value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus />
        <input style={input} placeholder="Password" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} />

        {error && <div style={{ fontSize: 12, color: "#f87171", marginBottom: 12 }}>{error}</div>}

        <button
          onClick={submit}
          disabled={busy}
          style={{
            width: "100%", padding: "11px 0", borderRadius: 8, border: "none", cursor: busy ? "default" : "pointer",
            background: "#4f46e5", color: "white", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>

        <div style={{ fontSize: 11, color: "#475569", textAlign: "center", marginTop: 16 }}>
          The very first account created on this app automatically becomes the admin account.
        </div>
      </div>
    </div>
  );
}
