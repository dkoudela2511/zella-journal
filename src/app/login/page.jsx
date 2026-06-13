"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (res?.error) setErr("Špatný e-mail nebo heslo.");
    else router.push("/app");
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><img className="auth-logo" src="/real-edge-logo.png" alt="REAL EDGE" /></div>
        <h1>Přihlášení</h1>
        <p className="sub">Vítej zpět. Pokračuj ve sledování svého edge.</p>
        {err && <div className="auth-err">{err}</div>}
        <form onSubmit={submit}>
          <div className="auth-field">
            <label>E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="auth-field">
            <label>Heslo</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <button className="auth-btn" disabled={busy}>{busy ? "Přihlašuji…" : "Přihlásit se"}</button>
        </form>
        <div className="auth-alt">Nemáš účet? <Link href="/register">Zaregistruj se</Link></div>
      </div>
    </div>
  );
}
