"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

// Full Name -> email: "Namrith Tejas Thatikonda" -> "namrith.tejas.thatikonda@padyalu.local"
function usernameToEmail(fullName: string) {
  const clean = fullName.trim().toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "");
  return `${clean}@padyalu.local`;
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const validUsername = username.trim().length >= 2;

  const submit = async () => {
    setError("");
    if (!validUsername) { setError("Please enter your full name."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setBusy(true);
    const supabase = createClient();
    const email = usernameToEmail(username);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) { setError("Incorrect username or password."); setBusy(false); return; }
      window.location.href = "/";
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%", padding: "11px 14px",
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(212,175,55,0.35)",
    borderRadius: 8, color: "white", fontSize: 14, marginBottom: 12,
    boxSizing: "border-box", outline: "none", fontFamily: "inherit",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg,#1a0505 0%,#2d0a0a 40%,#1a1a2e 100%)",
      color: "#e2e8f0", fontFamily: "'Segoe UI',sans-serif",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>

        {/* Logo banner */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            background: "white", borderRadius: 12, padding: "10px 16px",
            display: "inline-block", marginBottom: 18, boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          }}>
            <Image src="/sasj-logo1.webp" alt="Silicon Andhra Logo" width={300} height={72} style={{ display: "block", objectFit: "contain" }} priority />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#c9a227", lineHeight: 1.3, marginBottom: 4 }}>
            సిలికానాంధ్ర రజతోత్సవం
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f0e8", marginBottom: 2 }}>
            శతక శంఖారావం అభ్యాసం
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Practice Tracker · Oakland 2026</div>
        </div>

        {/* Card */}
        <div style={{
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(212,175,55,0.2)",
          borderRadius: 14, padding: "24px 20px", backdropFilter: "blur(8px)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#c9a227", marginBottom: 16, textAlign: "center", letterSpacing: "0.06em" }}>
            SIGN IN
          </div>

          <input style={inp} placeholder="Full Name (e.g. Namrith Tejas Thatikonda)" value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()} autoFocus />
          <input style={inp} placeholder="Password" type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()} />

          {error && <div style={{ fontSize: 12, color: "#f87171", marginBottom: 12 }}>{error}</div>}

          <button onClick={submit} disabled={busy} style={{
            width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
            cursor: busy ? "default" : "pointer",
            background: "linear-gradient(90deg,#991b1b,#b91c1c)",
            boxShadow: "0 2px 12px rgba(185,28,28,0.4)",
            color: "white", fontSize: 14, fontWeight: 700,
            fontFamily: "inherit", opacity: busy ? 0.6 : 1,
          }}>
            {busy ? "Please wait…" : "Sign In →"}
          </button>
        </div>

        <div style={{ fontSize: 11, textAlign: "center", marginTop: 14 }}>
          <a href="https://forms.gle/PQhmtN4F1aDAtSUg9" target="_blank" rel="noopener noreferrer" style={{ color: "#c9a227", textDecoration: "underline" }}>
            Need Help? Submit your issue here
          </a>
        </div>
      </div>
    </div>
  );
}
