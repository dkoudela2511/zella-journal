"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

function num(v) { return parseFloat(v); }
function computePnl(t, instMap) {
  const inst = instMap && instMap[String(t.symbol || "").trim().toUpperCase()];
  const e = num(t.entryPrice), x = num(t.exitPrice), q = num(t.quantity);
  const fees = isFinite(num(t.fees)) ? num(t.fees) : 0;
  if (inst && isFinite(e) && isFinite(x) && isFinite(q) && inst.tickSize > 0) {
    const move = t.direction === "short" ? (e - x) : (x - e);
    return (move / inst.tickSize) * inst.tickValue * q - fees;
  }
  if (isFinite(e) && isFinite(x) && isFinite(q)) {
    const g = t.direction === "short" ? (e - x) * q : (x - e) * q;
    return g - fees;
  }
  const m = num(t.pnl);
  return isFinite(m) ? m : 0;
}
function money(n) {
  const v = Math.round((n || 0) * 100) / 100;
  return (v >= 0 ? "+" : "") + v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) + " $";
}
function dt(s) { try { return new Date(s).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" }); } catch { return s || "—"; } }

export default function MentorView({ userId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/admin/student?userId=${encodeURIComponent(userId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setData)
      .catch(() => setErr("Nepodařilo se načíst data studenta."));
  }, [userId]);

  const fwById = useMemo(() => {
    const m = {};
    (data?.frameworks || []).forEach((f) => { m[f.id] = f; });
    return m;
  }, [data]);

  const instMap = useMemo(() => {
    const m = {};
    (data?.instruments || []).forEach((i) => { if (i && i.symbol) m[String(i.symbol).toUpperCase()] = i; });
    return m;
  }, [data]);

  const stats = useMemo(() => {
    const real = (data?.trades || []).filter((t) => !t.missed);
    const pnls = real.map((t) => computePnl(t, instMap));
    const net = pnls.reduce((a, b) => a + b, 0);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const grossWin = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    const n = real.length;
    return {
      n, net,
      winRate: n ? (wins.length / n) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
      avg: n ? net / n : 0,
    };
  }, [data, instMap]);

  const sorted = useMemo(
    () => [...(data?.trades || [])].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [data]
  );

  if (err) return <div className="admin-wrap"><div className="auth-err">{err}</div><Link href="/admin" className="admin-link">← Zpět</Link></div>;
  if (!data) return <div className="admin-wrap"><div className="admin-empty">Načítám…</div></div>;

  const name = data.user?.name || data.user?.email || "Student";

  return (
    <div className="admin-wrap">
      <div className="admin-top">
        <div className="admin-brand">
          <Link href="/admin" className="admin-link">← Zpět na seznam</Link>
        </div>
        <span className="ro-badge">Jen pro čtení</span>
      </div>

      <h2 className="mv-title">{name}</h2>
      <div className="mv-mail">{data.user?.email}</div>

      <div className="mv-kpis">
        <div className="mv-kpi"><span>Obchodů</span><b>{stats.n}</b></div>
        <div className="mv-kpi"><span>Net P&L</span><b className={stats.net >= 0 ? "pos" : "neg"}>{stats.n ? money(stats.net) : "—"}</b></div>
        <div className="mv-kpi"><span>Win rate</span><b>{stats.n ? `${stats.winRate.toFixed(0)} %` : "—"}</b></div>
        <div className="mv-kpi"><span>Profit factor</span><b>{stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}</b></div>
        <div className="mv-kpi"><span>Ø na obchod</span><b className={stats.avg >= 0 ? "pos" : "neg"}>{stats.n ? money(stats.avg) : "—"}</b></div>
      </div>

      <div className="admin-card">
        {sorted.length === 0 ? (
          <div className="admin-empty">Student zatím nemá žádné obchody.</div>
        ) : (
          <table className="admin-tbl">
            <thead>
              <tr>
                <th>Datum</th><th>Symbol</th><th>Směr</th><th>Playbook</th>
                <th className="r">Vstup</th><th className="r">Výstup</th><th className="r">Velikost</th><th className="r">P&L</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const p = computePnl(t, instMap); const f = fwById[t.frameworkId];
                return (
                  <tr key={t.id} className={t.missed ? "row-missed" : ""}>
                    <td>{dt(t.date)}</td>
                    <td>{t.symbol || "—"} {t.missed && <span className="miss">MISS</span>}</td>
                    <td><span className={`pill ${t.direction}`}>{t.direction === "long" ? "Long" : "Short"}</span></td>
                    <td>{f ? <><i className="fdot" style={{ background: f.color }} />{f.name}</> : "—"}</td>
                    <td className="r">{t.entryPrice || "—"}</td>
                    <td className="r">{t.exitPrice || "—"}</td>
                    <td className="r">{t.quantity || "—"}</td>
                    <td className={`r ${p >= 0 ? "pos" : "neg"}`}>{t.missed ? "—" : money(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
