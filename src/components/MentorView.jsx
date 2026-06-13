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
function dayLabel(k) {
  try {
    const d = new Date(k + "T00:00:00");
    return d.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch { return k; }
}
function adhLabel(v) { return v === "yes" ? "Držel plán" : v === "partial" ? "Částečně" : v === "no" ? "Nedržel" : "—"; }

export default function MentorView({ userId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("plans");
  const [light, setLight] = useState(null);

  useEffect(() => {
    fetch(`/api/admin/student?userId=${encodeURIComponent(userId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setErr("Nepodařilo se načíst data studenta."));
  }, [userId]);

  const fwById = useMemo(() => {
    const m = {}; (data?.frameworks || []).forEach((f) => { m[f.id] = f; }); return m;
  }, [data]);
  const instMap = useMemo(() => {
    const m = {}; (data?.instruments || []).forEach((i) => { if (i && i.symbol) m[String(i.symbol).toUpperCase()] = i; }); return m;
  }, [data]);

  const mtrades = data?.mentorTrades || [];
  const plans = data?.mentorPlans || {};

  const planDays = useMemo(() => {
    const keys = new Set(Object.keys(plans || {}));
    mtrades.forEach((t) => { const k = (t.date || "").slice(0, 10); if (k) keys.add(k); });
    return [...keys].sort((a, b) => (a < b ? 1 : -1));
  }, [plans, mtrades]);

  const stats = useMemo(() => {
    const real = mtrades.filter((t) => !t.missed);
    const pnls = real.map((t) => computePnl(t, instMap));
    const net = pnls.reduce((a, b) => a + b, 0);
    const wins = pnls.filter((p) => p > 0);
    const n = real.length;
    return { n, net, winRate: n ? (wins.length / n) * 100 : 0, avg: n ? net / n : 0 };
  }, [mtrades, instMap]);

  const adh = useMemo(() => {
    const c = { yes: 0, partial: 0, no: 0 };
    Object.values(plans || {}).forEach((p) => { if (p && c[p.adherence] != null) c[p.adherence]++; });
    return c;
  }, [plans]);

  const onComment = async (dayKey, comment) => {
    const r = await fetch("/api/admin/student", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, dayKey, comment }) });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      setData((prev) => {
        const np = { ...(prev.mentorPlans || {}) };
        np[dayKey] = { ...(np[dayKey] || {}), mentorComment: comment, mentorAt: d.mentorAt };
        return { ...prev, mentorPlans: np };
      });
      return true;
    }
    return false;
  };

  if (err) return <div className="admin-wrap"><div className="auth-err">{err}</div><Link href="/admin" className="admin-link">← Zpět</Link></div>;
  if (!data) return <div className="admin-wrap"><div className="admin-empty">Načítám…</div></div>;

  const name = data.user?.name || data.user?.email || "Student";
  const tradesSorted = [...mtrades].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="admin-wrap">
      <div className="admin-top">
        <div className="admin-brand"><Link href="/admin" className="admin-link">← Zpět na seznam</Link></div>
        <span className="ro-badge">Mentoring</span>
      </div>

      <h2 className="mv-title">{name}</h2>
      <div className="mv-mail">{data.user?.email}</div>

      <div className="mv-kpis">
        <div className="mv-kpi"><span>Dozor. obchodů</span><b>{stats.n}</b></div>
        <div className="mv-kpi"><span>Net P&L</span><b className={stats.net >= 0 ? "pos" : "neg"}>{stats.n ? money(stats.net) : "—"}</b></div>
        <div className="mv-kpi"><span>Win rate</span><b>{stats.n ? `${stats.winRate.toFixed(0)} %` : "—"}</b></div>
        <div className="mv-kpi"><span>Držel plán</span><b className="pos">{adh.yes}×</b></div>
        <div className="mv-kpi"><span>Nedržel</span><b className="neg">{adh.no}×</b></div>
      </div>

      <div className="mtr-tabs">
        <button className={tab === "plans" ? "on" : ""} onClick={() => setTab("plans")}>Denní plány</button>
        <button className={tab === "trades" ? "on" : ""} onClick={() => setTab("trades")}>Dozorované obchody</button>
      </div>

      {tab === "plans" ? (
        planDays.length === 0 ? (
          <div className="admin-card pad"><div className="sec-empty">Student zatím nemá žádný denní plán.</div></div>
        ) : (
          planDays.map((k) => (
            <PlanReview key={k} dk={k} plan={plans[k] || {}} onComment={onComment} onLight={setLight} />
          ))
        )
      ) : (
        <div className="admin-card">
          {tradesSorted.length === 0 ? (
            <div className="admin-empty">Žádné dozorované obchody.</div>
          ) : (
            <table className="admin-tbl">
              <thead>
                <tr><th>Datum</th><th>Symbol</th><th>Směr</th><th>Playbook</th><th className="r">Vstup</th><th className="r">Výstup</th><th className="r">Velikost</th><th className="r">P&L</th></tr>
              </thead>
              <tbody>
                {tradesSorted.map((t) => {
                  const p = computePnl(t, instMap); const f = fwById[t.frameworkId];
                  return (
                    <tr key={t.id}>
                      <td>{dt(t.date)}</td>
                      <td>{t.symbol || "—"}</td>
                      <td><span className={`pill ${t.direction}`}>{t.direction === "long" ? "Long" : "Short"}</span></td>
                      <td>{f ? <><i className="fdot" style={{ background: f.color }} />{f.name}</> : "—"}</td>
                      <td className="r">{t.entryPrice || "—"}</td>
                      <td className="r">{t.exitPrice || "—"}</td>
                      <td className="r">{t.quantity || "—"}</td>
                      <td className={`r ${p >= 0 ? "pos" : "neg"}`}>{money(p)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {light && <div className="mv-light" onClick={() => setLight(null)}><img src={light} alt="" /></div>}
    </div>
  );
}

function PlanReview({ dk, plan, onComment, onLight }) {
  const [c, setC] = useState(plan.mentorComment || "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setC(plan.mentorComment || ""); }, [plan.mentorComment]);
  const save = async () => {
    setBusy(true);
    const ok = await onComment(dk, c);
    setBusy(false);
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1500); }
  };
  const shots = [...(plan.planShots || []), ...(plan.debriefShots || [])];
  const has = plan.bias || plan.levels || plan.scenarios || plan.outcome || plan.lessons || shots.length;

  return (
    <div className="admin-card pad pr-card">
      <div className="pr-head">
        <span className="pr-date">{dayLabel(dk)}</span>
        {plan.adherence && <span className={`adh-chip ${plan.adherence}`}>{adhLabel(plan.adherence)}</span>}
      </div>

      {!has ? <div className="sec-empty">Prázdný den (zatím bez plánu).</div> : (
        <div className="pr-grid">
          <div>
            <h4>📋 Plán</h4>
            {plan.bias && <p><b>Bias:</b> {plan.bias}</p>}
            {plan.levels && <p><b>Úrovně:</b> {plan.levels}</p>}
            {plan.scenarios && <p><b>Scénáře:</b> {plan.scenarios}</p>}
          </div>
          <div>
            <h4>✅ Debrief</h4>
            {plan.outcome && <p><b>Jak dopadlo:</b> {plan.outcome}</p>}
            {plan.lessons && <p><b>Poučení:</b> {plan.lessons}</p>}
          </div>
        </div>
      )}

      {shots.length > 0 && (
        <div className="pr-shots">
          {shots.map((s, i) => <img key={i} src={s} alt="" onClick={() => onLight(s)} />)}
        </div>
      )}

      <div className="pr-comment">
        <label>Komentář mentora (student ho uvidí)</label>
        <textarea rows={2} value={c} onChange={(e) => setC(e.target.value)} placeholder="Tvoje zpětná vazba k tomuto dni…" />
        <div className="pr-comment-foot">
          {saved && <span className="plan-saved">Uloženo ✓</span>}
          <button className="btn-view" onClick={save} disabled={busy}>{busy ? "Ukládám…" : "Uložit komentář"}</button>
        </div>
      </div>
    </div>
  );
}
