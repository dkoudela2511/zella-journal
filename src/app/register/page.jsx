"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.error || "Registrace se nezdařila."); setBusy(false); return; }
    // rovnou přihlásit
    const login = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (login?.error) router.push("/login");
    else router.push("/app");
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><span className="auth-mark">Z</span><span className="auth-name">Zella&nbsp;Journal</span></div>
        <h1>Vytvoř účet</h1>
        <p className="sub">Začni budovat svůj trading deník.</p>
        {err && <div className="auth-err">{err}</div>}
        <form onSubmit={submit}>
          <div className="auth-field">
            <label>Jméno (volitelné)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div className="auth-field">
            <label>E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="auth-field">
            <label>Heslo (min. 6 znaků)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </div>
          <button className="auth-btn" disabled={busy}>{busy ? "Zakládám…" : "Zaregistrovat se"}</button>
        </form>
        <div className="auth-alt">Už máš účet? <Link href="/login">Přihlas se</Link></div>
      </div>
    </div>
  );
}
