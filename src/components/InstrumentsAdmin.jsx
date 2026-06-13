"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

const BLANK = { symbol: "", name: "", tickSize: "", tickValue: "", currency: "USD" };

export default function InstrumentsAdmin() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(BLANK);
  const [editingSymbol, setEditingSymbol] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch("/api/instruments")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => setList(d.instruments || []))
      .catch(() => setErr("Nepodařilo se načíst instrumenty."));
  };
  useEffect(load, []);

  const startEdit = (i) => { setEditingSymbol(i.symbol); setForm({ symbol: i.symbol, name: i.name || "", tickSize: String(i.tickSize), tickValue: String(i.tickValue), currency: i.currency || "USD" }); setErr(""); };
  const reset = () => { setEditingSymbol(null); setForm(BLANK); setErr(""); };

  const save = async () => {
    setErr(""); setBusy(true);
    const res = await fetch("/api/admin/instruments", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, tickSize: Number(form.tickSize), tickValue: Number(form.tickValue) }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(d.error || "Uložení se nezdařilo."); return; }
    reset(); load();
  };

  const del = async (symbol) => {
    if (!window.confirm(`Smazat instrument ${symbol}?`)) return;
    await fetch(`/api/admin/instruments?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
    if (editingSymbol === symbol) reset();
    load();
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const formValid = form.symbol.trim() && Number(form.tickSize) > 0 && Number(form.tickValue) > 0;

  return (
    <div className="admin-wrap">
      <div className="admin-top">
        <div className="admin-brand"><Link href="/admin" className="admin-link">← Zpět na seznam</Link></div>
        <span className="ro-badge" style={{ background: "#EDE9FE", color: "#6D44E0", border: "1px solid #DDD2FA" }}>Spravuje jen admin</span>
      </div>

      <h2 className="mv-title">Instrumenty (trhy)</h2>
      <div className="mv-mail">Tick size = nejmenší pohyb ceny. Tick value = hodnota 1 ticku v USD na 1 kontrakt. Z toho se počítá USD P&L, risk a R. Studenti je vidí jen ke čtení.</div>

      <div className="inst-form admin-card">
        <div className="inst-grid">
          <label>Symbol<input value={form.symbol} onChange={set("symbol")} placeholder="ZW" disabled={!!editingSymbol} /></label>
          <label>Název<input value={form.name} onChange={set("name")} placeholder="Wheat" /></label>
          <label>Tick size<input value={form.tickSize} onChange={set("tickSize")} placeholder="0.25" inputMode="decimal" /></label>
          <label>Tick value (USD)<input value={form.tickValue} onChange={set("tickValue")} placeholder="12.5" inputMode="decimal" /></label>
          <label>Měna<input value={form.currency} onChange={set("currency")} placeholder="USD" /></label>
        </div>
        {err && <div className="auth-err" style={{ marginTop: 12 }}>{err}</div>}
        <div className="inst-actions">
          {editingSymbol && <button className="admin-link" onClick={reset}>Zrušit úpravu</button>}
          <button className="auth-btn" style={{ width: "auto", padding: "10px 18px" }} disabled={!formValid || busy} onClick={save}>
            {busy ? "Ukládám…" : editingSymbol ? "Uložit změny" : "Přidat instrument"}
          </button>
        </div>
      </div>

      {!list && !err && <div className="admin-empty">Načítám…</div>}
      {list && list.length === 0 && <div className="admin-empty">Zatím žádné instrumenty. Přidej první výše.</div>}
      {list && list.length > 0 && (
        <div className="admin-card" style={{ marginTop: 18 }}>
          <table className="admin-tbl">
            <thead><tr><th>Symbol</th><th>Název</th><th className="r">Tick size</th><th className="r">Tick value</th><th>Měna</th><th></th></tr></thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.symbol}>
                  <td><b>{i.symbol}</b></td>
                  <td>{i.name || "—"}</td>
                  <td className="r">{i.tickSize}</td>
                  <td className="r">{i.tickValue} {i.currency}</td>
                  <td>{i.currency}</td>
                  <td className="r">
                    <button className="btn-view" style={{ background: "none", border: 0, cursor: "pointer", marginRight: 12 }} onClick={() => startEdit(i)}>Upravit</button>
                    <button style={{ background: "none", border: 0, cursor: "pointer", color: "#E0414B", fontWeight: 600, fontSize: 13 }} onClick={() => del(i.symbol)}>Smazat</button>
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
