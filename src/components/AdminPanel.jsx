"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

function money(n) {
  const v = Math.round((n || 0) * 100) / 100;
  return (v >= 0 ? "+" : "") + v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) + " $";
}
function dateCz(s) {
  try { return new Date(s).toLocaleDateString("cs-CZ"); } catch { return "—"; }
}

export default function AdminPanel() {
  const [users, setUsers] = useState(null);
  const [mentor, setMentor] = useState(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  const loadMentor = () => {
    fetch("/api/mentor")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setMentor(d))
      .catch(() => {});
  };

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setUsers(d.users || []))
      .catch(() => setErr("Nepodařilo se načíst uživatele."));
    loadMentor();
  }, []);

  const genCode = async () => {
    setBusy(true);
    try {
      await fetch("/api/mentor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "invite", note }) });
      setNote(""); loadMentor();
    } catch {}
    setBusy(false);
  };
  const delCode = async (code) => {
    if (!window.confirm("Smazat tento kód?")) return;
    await fetch("/api/mentor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "deleteCode", code }) });
    loadMentor();
  };
  const unenroll = async (userId) => {
    if (!window.confirm("Odebrat studenta z mentoringu? Ztratí přístup do sekce Mentoring.")) return;
    await fetch("/api/mentor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unenroll", userId }) });
    loadMentor();
  };
  const copy = (code) => {
    try { navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(""), 1500); } catch {}
  };

  const codes = mentor?.codes || [];
  const students = mentor?.students || [];
  const unusedCodes = codes.filter((c) => !c.used);

  return (
    <div className="admin-wrap">
      <div className="admin-top">
        <div className="admin-brand"><span className="auth-mark">Z</span><span>Mentor – přehled</span></div>
        <div className="admin-actions">
          <Link href="/admin/instruments" className="admin-link">Instrumenty</Link>
          <Link href="/app" className="admin-link">Můj deník</Link>
          <button className="admin-link" onClick={() => signOut({ callbackUrl: "/login" })}>Odhlásit</button>
        </div>
      </div>

      {err && <div className="auth-err">{err}</div>}

      {/* Zvací kódy */}
      <div className="admin-card pad">
        <h3 className="sec-h">Zvací kódy</h3>
        <p className="sec-sub">Vygeneruj kód a předej ho člověku, kterého chceš mentorovat. Bez kódu se do sekce Mentoring nikdo nedostane.</p>
        <div className="code-gen">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pro koho je kód (volitelné, např. Honza)" />
          <button className="btn-view" onClick={genCode} disabled={busy}>{busy ? "Generuji…" : "+ Vygenerovat kód"}</button>
        </div>
        {codes.length > 0 && (
          <table className="admin-tbl mt">
            <thead><tr><th>Kód</th><th>Pro koho</th><th>Stav</th><th></th></tr></thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code}>
                  <td><span className="code-pill">{c.code}</span></td>
                  <td>{c.note || "—"}</td>
                  <td>{c.used ? <span className="tag-student">použil: {c.usedByName}</span> : <span className="tag-free">volný</span>}</td>
                  <td className="r nowrap">
                    {!c.used && <button className="lnk" onClick={() => copy(c.code)}>{copied === c.code ? "zkopírováno ✓" : "kopírovat"}</button>}
                    <button className="lnk del" onClick={() => delCode(c.code)}>smazat</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {codes.length === 0 && <div className="sec-empty">Zatím žádné kódy. Vygeneruj první.</div>}
      </div>

      {/* Moji studenti */}
      <div className="admin-card pad">
        <h3 className="sec-h">Moji studenti <span className="count">{students.length}</span>{mentor?.totalNew > 0 && <span className="new-badge">{mentor.totalNew} {mentor.totalNew === 1 ? "nový plán" : mentor.totalNew <= 4 ? "nové plány" : "nových plánů"}</span>}</h3>
        {students.length === 0 ? (
          <div className="sec-empty">Zatím nikdo. Jakmile někdo použije tvůj kód, objeví se tady.</div>
        ) : (
          <table className="admin-tbl">
            <thead>
              <tr><th>Student</th><th className="r">Plánů</th><th className="r">Dozor. obchodů</th><th className="r">Net P&L</th><th className="r">Win rate</th><th></th></tr>
            </thead>
            <tbody>
              {students.map((u) => (
                <tr key={u.id}>
                  <td><div className="u-name">{u.name || "—"}{u.newPlans > 0 && <span className="dot-badge" title={`${u.newPlans} nových plánů`}>{u.newPlans}</span>}</div><div className="u-mail">{u.email}</div></td>
                  <td className="r">{u.planCount}</td>
                  <td className="r">{u.tradeCount}</td>
                  <td className={`r ${u.netPnl >= 0 ? "pos" : "neg"}`}>{u.tradeCount ? money(u.netPnl) : "—"}</td>
                  <td className="r">{u.tradeCount ? `${u.winRate.toFixed(0)} %` : "—"}</td>
                  <td className="r nowrap">
                    <Link href={`/admin/student/${u.id}`} className="btn-view">Mentoring →</Link>
                    <button className="lnk del" onClick={() => unenroll(u.id)}>odebrat</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Všichni registrovaní */}
      <div className="admin-card pad">
        <h3 className="sec-h">Všichni registrovaní</h3>
        {!users && !err && <div className="sec-empty">Načítám…</div>}
        {users && users.length === 0 && <div className="sec-empty">Zatím žádní uživatelé.</div>}
        {users && users.length > 0 && (
          <table className="admin-tbl">
            <thead>
              <tr><th>Uživatel</th><th>Role</th><th>Registrace</th><th className="r">Obchodů</th><th></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><div className="u-name">{u.name || "—"}</div><div className="u-mail">{u.email}</div></td>
                  <td>{u.role === "admin" ? <span className="tag-admin">admin</span> : <span className="tag-student">student</span>}</td>
                  <td>{dateCz(u.createdAt)}</td>
                  <td className="r">{u.tradeCount}</td>
                  <td className="r">{u.role !== "admin" && <Link href={`/admin/student/${u.id}`} className="btn-view">Zobrazit →</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
