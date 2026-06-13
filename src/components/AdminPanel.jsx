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
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => setUsers(d.users || []))
      .catch(() => setErr("Nepodařilo se načíst uživatele."));
  }, []);

  return (
    <div className="admin-wrap">
      <div className="admin-top">
        <div className="admin-brand"><span className="auth-mark">Z</span><span>Mentor – přehled studentů</span></div>
        <div className="admin-actions">
          <Link href="/app" className="admin-link">Můj deník</Link>
          <button className="admin-link" onClick={() => signOut({ callbackUrl: "/login" })}>Odhlásit</button>
        </div>
      </div>

      {err && <div className="auth-err">{err}</div>}

      {!users && !err && <div className="admin-empty">Načítám…</div>}

      {users && users.length === 0 && (
        <div className="admin-empty">Zatím žádní uživatelé. Až se někdo zaregistruje, objeví se tady.</div>
      )}

      {users && users.length > 0 && (
        <div className="admin-card">
          <table className="admin-tbl">
            <thead>
              <tr>
                <th>Uživatel</th><th>Role</th><th>Registrace</th>
                <th className="r">Obchodů</th><th className="r">Net P&L</th><th className="r">Win rate</th><th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="u-name">{u.name || "—"}</div>
                    <div className="u-mail">{u.email}</div>
                  </td>
                  <td>{u.role === "admin" ? <span className="tag-admin">admin</span> : <span className="tag-student">student</span>}</td>
                  <td>{dateCz(u.createdAt)}</td>
                  <td className="r">{u.tradeCount}</td>
                  <td className={`r ${u.netPnl >= 0 ? "pos" : "neg"}`}>{u.tradeCount ? money(u.netPnl) : "—"}</td>
                  <td className="r">{u.tradeCount ? `${u.winRate.toFixed(0)} %` : "—"}</td>
                  <td className="r">
                    {u.role !== "admin" && <Link href={`/admin/student/${u.id}`} className="btn-view">Zobrazit deník →</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
