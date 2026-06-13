"use client";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Plus, Pencil, Trash2, X, Search, TrendingUp, TrendingDown, LayoutDashboard,
  BookOpen, CalendarDays, Layers, ChevronLeft, ChevronRight, ChevronDown, Wallet, Target,
  ClipboardList, FileText, NotebookText, BarChart3, Check, ListChecks, Settings, Image as ImageIcon,
  GraduationCap, Lock, ShieldCheck, AlertTriangle,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine,
  RadarChart, PolarGrid, PolarAngleAxis, Radar, BarChart, Bar, Cell,
} from "recharts";
import Papa from "papaparse";

/* ================================================================== *
 *  Zella-style trading journal  ·  Fáze: deník + frameworky + score
 *  Data per uživatel v databázi přes /api/store (Next.js + Prisma + Postgres).
 * ================================================================== */

const T_KEY = "tz:trades:v1";
const F_KEY = "tz:frameworks:v1";
const S_KEY = "tz:settings:v1";
const N_KEY = "tz:dailynotes:v1";
const NB_KEY = "tz:notebook:v1";
const P_KEY = "tz:progress:v1";
const A_KEY = "tz:accounts:v1";
const D_KEY = "tz:dashmode:v1";
const MP_KEY = "tz:mentor:plans:v1";
const MT_KEY = "tz:mentor:trades:v1";

const IMPORT_FIELDS = [
  { key: "date", label: "Datum / čas" },
  { key: "symbol", label: "Symbol" },
  { key: "direction", label: "Směr (long/short)" },
  { key: "entryPrice", label: "Vstupní cena" },
  { key: "exitPrice", label: "Výstupní cena" },
  { key: "quantity", label: "Velikost" },
  { key: "stopLoss", label: "Stop loss" },
  { key: "fees", label: "Poplatky" },
  { key: "pnl", label: "P&L (ručně)" },
  { key: "mae", label: "MAE (max proti)" },
  { key: "mfe", label: "MFE (max pro)" },
  { key: "playbook", label: "Playbook (název)" },
  { key: "tags", label: "Tagy (; nebo ,)" },
  { key: "notes", label: "Poznámky" },
];
const IMPORT_GUESS = {
  date: ["date", "time", "datum", "čas", "opened", "open time", "datetime"],
  symbol: ["symbol", "ticker", "instrument", "pair", "market", "asset"],
  direction: ["side", "direction", "type", "buy/sell", "b/s", "směr", "long/short"],
  entryPrice: ["entry", "entry price", "open price", "price in", "vstup"],
  exitPrice: ["exit", "exit price", "close price", "price out", "výstup"],
  quantity: ["qty", "quantity", "size", "volume", "lots", "velikost", "amount", "shares", "units"],
  stopLoss: ["stop", "sl", "stop loss", "stoploss"],
  fees: ["fee", "fees", "commission", "poplatek", "poplatky"],
  pnl: ["pnl", "p&l", "p/l", "profit", "net", "realized", "výsledek", "zisk", "gain"],
  mae: ["mae", "max adverse", "adverse excursion", "maxadverse", "drawdown"],
  mfe: ["mfe", "max favorable", "favorable excursion", "maxfavorable", "runup", "run-up"],
  playbook: ["playbook", "strategy", "setup", "framework", "strategie"],
  tags: ["tag", "tags", "tagy", "labels"],
  notes: ["note", "notes", "comment", "poznámka", "poznámky", "description"],
};
const padNum = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) => `${d.getFullYear()}-${padNum(d.getMonth() + 1)}-${padNum(d.getDate())}T${padNum(d.getHours())}:${padNum(d.getMinutes())}`;
function parseNumStr(v) {
  if (v == null) return "";
  let s = String(v).trim().replace(/[^0-9,.\-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? String(n) : "";
}
function guessMapping(cols) {
  const m = {}; const used = new Set();
  IMPORT_FIELDS.forEach((f) => {
    const kws = IMPORT_GUESS[f.key] || [];
    const hit = cols.find((c) => !used.has(c) && kws.some((kw) => c.toLowerCase().trim() === kw || c.toLowerCase().includes(kw)));
    if (hit) { m[f.key] = hit; used.add(hit); }
  });
  return m;
}

/* ---------- NinjaTrader (Trades export) ---------- */
const NT_FEE_COLS = ["Commission", "Clearing Fee", "Exchange Fee", "IP Fee", "NFA Fee"];
function ntRoot(instr) { return String(instr || "").trim().split(/\s+/)[0].toUpperCase(); } // "6E JUN26" -> "6E"
function ntNum(v) { const n = parseFloat(parseNumStr(v)); return isFinite(n) ? n : 0; }
function parseNinjaDate(s) {
  const m = String(s || "").trim().match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
}
const round = (n, d) => { const f = Math.pow(10, d); return Math.round(n * f) / f; };

// Seskupí řádky se stejným vstupem do jednoho obchodu (volba B)
function groupNinjaTrades(rows) {
  const groups = {};
  (rows || []).forEach((r) => {
    const instr = r["Instrument"]; if (!instr) return;
    const root = ntRoot(instr);
    const dir = /short/i.test(r["Market pos."] || "") ? "short" : "long";
    const entry = ntNum(r["Entry price"]);
    const entryTime = String(r["Entry time"] || "");
    const key = [root, dir, entryTime, entry].join("|");
    if (!groups[key]) groups[key] = { root, dir, entry, entryTime, exitTime: String(r["Exit time"] || ""), qty: 0, exitSum: 0, profit: 0, fees: 0, mae: 0, mfe: 0, strategy: String(r["Strategy"] || "").trim() };
    const g = groups[key];
    const qty = ntNum(r["Qty"]);
    g.qty += qty;
    g.exitSum += ntNum(r["Exit price"]) * qty;
    g.profit += ntNum(r["Profit"]);
    NT_FEE_COLS.forEach((c) => { if (r[c] != null) g.fees += ntNum(r[c]); });
    g.mae += ntNum(r["MAE"]);
    g.mfe += ntNum(r["MFE"]);
    const et = parseNinjaDate(r["Exit time"]); const ge = parseNinjaDate(g.exitTime);
    if (et && ge && et > ge) g.exitTime = String(r["Exit time"]);
  });
  return Object.values(groups).map((g) => ({
    symbol: g.root,
    direction: g.dir,
    quantity: g.qty ? String(g.qty) : "",
    entryPrice: g.entry ? String(g.entry) : "",
    exitPrice: g.qty ? String(round(g.exitSum / g.qty, 8)) : "",
    date: parseNinjaDate(g.entryTime),
    fees: String(round(g.fees, 2)),
    mae: String(round(g.mae, 2)),
    mfe: String(round(g.mfe, 2)),
    pnl: String(round(g.profit, 2)),
    strategy: g.strategy,
  }));
}
function isNinjaTrades(cols) {
  const set = new Set((cols || []).map((c) => String(c).trim()));
  return set.has("Instrument") && set.has("Market pos.") && set.has("Entry price") && set.has("Exit price");
}

const FW_COLORS = ["#17386F", "#16C784", "#F59E0B", "#EC4899", "#06B6D4", "#F0454E", "#8B5CF6", "#84CC16"];

/* ---------- TradingView symbol mapping ---------- */
const TV_FUT = {
  ES: "CME_MINI:ES1!", MES: "CME_MINI:MES1!", NQ: "CME_MINI:NQ1!", MNQ: "CME_MINI:MNQ1!",
  RTY: "CME_MINI:RTY1!", M2K: "CME_MINI:M2K1!", YM: "CBOT_MINI:YM1!", MYM: "CBOT_MINI:MYM1!",
  CL: "NYMEX:CL1!", MCL: "NYMEX:MCL1!", GC: "COMEX:GC1!", MGC: "COMEX:MGC1!", SI: "COMEX:SI1!",
  NG: "NYMEX:NG1!", ZB: "CBOT:ZB1!", ZN: "CBOT:ZN1!", ZC: "CBOT:ZC1!", ZS: "CBOT:ZS1!",
  "6E": "CME:6E1!", "6B": "CME:6B1!", "6J": "CME:6J1!", "6A": "CME:6A1!",
};
const TV_FX = new Set(["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "EURCHF"]);
function tvSymbol(raw) {
  let s = (raw || "").toString().trim().toUpperCase();
  if (!s) return "CME_MINI:ES1!";
  if (s.includes(":")) return s;                 // už plný TV symbol (např. NASDAQ:AAPL)
  if (TV_FUT[s]) return TV_FUT[s];               // futures kontrakty
  if (TV_FX.has(s)) return "OANDA:" + s;         // forex
  if (/USDT$/.test(s)) return "BINANCE:" + s;    // krypto (BTCUSDT…)
  if (/^(BTC|ETH|SOL|XRP|ADA|DOGE|BNB)USD$/.test(s)) return "BINANCE:" + s.replace(/USD$/, "USDT");
  return s;                                       // akcie – TradingView si poradí (AAPL, TSLA…)
}

function ChartModal({ symbol, date, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    host.appendChild(widget);
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol: tvSymbol(symbol),
      interval: "5",
      timezone: "Europe/Prague",
      theme: "light",
      style: "1",
      locale: "cs",
      autosize: true,
      allow_symbol_change: true,
      withdateranges: true,
      hide_side_toolbar: false,
      calendar: false,
    });
    host.appendChild(script);
    return () => { if (host) host.innerHTML = ""; };
  }, [symbol]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet chart-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <h3>Graf — {symbol || "?"}{date ? ` · ${(date || "").slice(0, 10)}` : ""}</h3>
          <button className="x" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="chart-body">
          <div className="tradingview-widget-container" ref={ref} style={{ height: "100%", width: "100%" }} />
        </div>
        <div className="chart-note">Tip: vlevo nahoře v grafu lze změnit symbol i timeframe a posunem se dostaneš na datum svého obchodu. Data dodává TradingView (zdarma).</div>
      </div>
    </div>
  );
}

/* ---------- storage wrapper → backend API (per-user, DB-backed) ---------- */
const store = {
  async get(k) {
    try {
      const r = await fetch(`/api/store?key=${encodeURIComponent(k)}`);
      if (!r.ok) return null;
      const d = await r.json();
      return d.found ? d.value : null;
    } catch { return null; }
  },
  async set(k, v) {
    try {
      await fetch("/api/store", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "set", key: k, value: v }) });
    } catch {}
  },
  async delete(k) {
    try {
      await fetch("/api/store", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "delete", key: k }) });
    } catch {}
  },
};

/* ---------- math ---------- */
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : NaN; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- instrumenty (tick size / tick value) ---------- */
let INSTR = {}; // symbol(UPPER) -> { tickSize, tickValue, ... }
function setInstruments(list) {
  const m = {};
  (list || []).forEach((i) => { if (i && i.symbol) m[String(i.symbol).toUpperCase()] = i; });
  INSTR = m;
}
function instrFor(t) {
  const s = (t.symbol || "").toString().trim().toUpperCase();
  return s && INSTR[s] ? INSTR[s] : null;
}

function computePnl(t) {
  const inst = instrFor(t);
  const e = num(t.entryPrice), x = num(t.exitPrice), q = num(t.quantity);
  const fees = isFinite(num(t.fees)) ? num(t.fees) : 0;
  if (inst && isFinite(e) && isFinite(x) && isFinite(q) && inst.tickSize > 0) {
    const move = t.direction === "short" ? (e - x) : (x - e);   // příznivý pohyb v ceně
    const ticks = move / inst.tickSize;
    return ticks * inst.tickValue * q - fees;                    // USD
  }
  if (isFinite(e) && isFinite(x) && isFinite(q)) {
    const g = t.direction === "short" ? (e - x) * q : (x - e) * q;
    return g - fees;
  }
  const m = num(t.pnl);
  return isFinite(m) ? m : 0;
}
function computeR(t) {
  const inst = instrFor(t);
  const e = num(t.entryPrice), st = num(t.stopLoss), q = num(t.quantity);
  if (isFinite(e) && isFinite(st) && isFinite(q) && e !== st) {
    if (inst && inst.tickSize > 0) {
      const riskTicks = Math.abs(e - st) / inst.tickSize;
      const riskUSD = riskTicks * inst.tickValue * q;
      if (riskUSD > 0) return computePnl(t) / riskUSD;
    } else {
      const risk = Math.abs(e - st) * q;
      if (risk > 0) return computePnl(t) / risk;
    }
  }
  return null;
}
function dayKey(iso) { return (iso || "").slice(0, 10); }

function equityAndDD(trades) {
  const chrono = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));
  let acc = 0, peak = 0, maxDD = 0;
  const curve = [{ i: 0, equity: 0, label: "Start" }];
  chrono.forEach((t, i) => {
    acc += computePnl(t);
    peak = Math.max(peak, acc);
    maxDD = Math.max(maxDD, peak - acc);
    curve.push({ i: i + 1, equity: acc, label: t.symbol || `#${i + 1}` });
  });
  return { curve, maxDD };
}

function computeStats(trades) {
  const n = trades.length;
  const pnls = trades.map(computePnl);
  const net = pnls.reduce((a, b) => a + b, 0);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const { maxDD } = equityAndDD(trades);

  // denní agregace pro konzistenci
  const byDay = {};
  trades.forEach((t) => { const k = dayKey(t.date); byDay[k] = (byDay[k] || 0) + computePnl(t); });
  const days = Object.values(byDay);
  const profitableDays = days.filter((d) => d > 0).length;

  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  const wlRatio = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 3 : 0);
  const recovery = maxDD > 0 ? net / maxDD : (net > 0 ? 3 : 0);

  return {
    n, net, grossWin, grossLoss, maxDD,
    winRate: n ? (wins.length / n) * 100 : 0,
    wins: wins.length, losses: losses.length,
    breakeven: pnls.filter((p) => p === 0).length,
    avgWin, avgLoss, profitFactor, wlRatio, recovery,
    expectancy: n ? net / n : 0,
    best: n ? Math.max(...pnls) : 0,
    worst: n ? Math.min(...pnls) : 0,
    consistency: days.length ? (profitableDays / days.length) * 100 : 0,
  };
}

/* Zella-style skóre: 6 os, každá 0–100, výsledek = průměr */
function scoreAxes(s) {
  const pf = s.profitFactor === Infinity ? 3 : s.profitFactor;
  return [
    { metric: "Win %", value: clamp(s.winRate, 0, 100) },
    { metric: "Profit factor", value: clamp((pf / 3) * 100, 0, 100) },
    { metric: "Win/Loss", value: clamp((s.wlRatio / 3) * 100, 0, 100) },
    { metric: "Recovery", value: clamp(((s.recovery === Infinity ? 3 : s.recovery) / 3) * 100, 0, 100) },
    { metric: "Konzistence", value: clamp(s.consistency, 0, 100) },
    { metric: "Drawdown", value: s.maxDD <= 0 ? (s.net > 0 ? 100 : 50) : clamp((s.grossWin / (s.grossWin + s.maxDD)) * 100, 0, 100) },
  ];
}
function overallScore(s) {
  if (!s.n) return 0;
  const ax = scoreAxes(s);
  return Math.round(ax.reduce((a, b) => a + b.value, 0) / ax.length);
}

/* ---------- format ---------- */
function fmtMoney(v, cur = "$") {
  if (!isFinite(v)) return "—";
  const sign = v < 0 ? "−" : "";
  return `${sign}${cur}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtCompact(v, cur = "$") {
  if (!isFinite(v) || v === 0) return `${cur}0`;
  const s = v < 0 ? "−" : "+", a = Math.abs(v);
  if (a >= 1000) return `${s}${cur}${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  return `${s}${cur}${a.toFixed(0)}`;
}
const fmtNum = (v, d = 2) => isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function pluralObchod(n) { return n === 1 ? "obchod" : n >= 2 && n <= 4 ? "obchody" : "obchodů"; }

const blankTrade = () => ({
  id: uid(), date: new Date().toISOString().slice(0, 16), symbol: "", direction: "long",
  frameworkId: "", entryPrice: "", exitPrice: "", quantity: "", stopLoss: "", fees: "", pnl: "", notes: "",
  tags: [], mistakes: [], rating: "", reviewed: false, missed: false, ruleChecks: [], mae: "", mfe: "",
  accountId: "", shots: [], source: "manual",
});
function fileToThumb(file, maxDim = 1100, quality = 0.62) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      try { res(c.toDataURL("image/jpeg", quality)); } catch (e) { rej(e); }
    };
    img.onerror = rej; img.src = url;
  });
}
const blankFw = () => ({ id: uid(), name: "", description: "", color: FW_COLORS[0], rules: [] });
const RATINGS = ["A+", "A", "B", "C", "D"];

const NB_RECAP_TMPL = `Nálada:\n\nCo se povedlo:\n- \n\nChyby:\n- \n\nCo příště jinak:\n- `;
const NB_WEEKLY_TMPL = `Net P&L za týden:\nNejlepší obchod:\nNejhorší obchod:\n\nVzorce, kterých si všímám:\n- \n\nCíle na příští týden:\n- `;
const seedFolders = () => ([
  { id: uid(), name: "Sessions Recap", color: "#17386F", template: NB_RECAP_TMPL },
  { id: uid(), name: "Týdenní recap", color: "#16C784", template: NB_WEEKLY_TMPL },
  { id: uid(), name: "Lekce & nápady", color: "#F59E0B", template: "" },
]);
const blankNote = () => ({ id: uid(), folderId: "", title: "", body: "", tags: [], updatedAt: Date.now() });
const blankFolder = () => ({ id: uid(), name: "", color: FW_COLORS[0], template: "" });

const seedRules = () => ([
  { id: uid(), name: "Začal jsem obchodovat včas", type: "manual", active: true },
  { id: uid(), name: "Držel jsem se svého plánu", type: "manual", active: true },
  { id: uid(), name: "Žádné revenge trading / přeobchodování", type: "manual", active: true },
  { id: uid(), name: "Zapsal jsem obchody do deníku", type: "manual", active: true },
  { id: uid(), name: "Každý obchod má playbook", type: "auto", kind: "hasPlaybook", active: true },
  { id: uid(), name: "Nepřekročil jsem denní max ztrátu", type: "auto", kind: "maxLoss", value: 200, active: true },
  { id: uid(), name: "Pohyb / cvičení", type: "manual", active: true },
  { id: uid(), name: "Studium / čtení", type: "manual", active: true },
]);
const localKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
function evalAutoRule(rule, dts) {
  if (rule.kind === "hasPlaybook") return dts.length === 0 ? true : dts.every((t) => !!t.frameworkId);
  if (rule.kind === "maxLoss") { const net = dts.reduce((a, t) => a + computePnl(t), 0); return net >= -(num(rule.value) || 0); }
  return true;
}
function buildHeatWeeks(nWeeks = 12) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); const dow = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dow - 7 * (nWeeks - 1));
  const weeks = [];
  for (let w = 0; w < nWeeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) { const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d); col.push({ key: localKey(dt), future: dt > today }); }
    weeks.push(col);
  }
  return weeks;
}
const pctColor = (p) => (p >= 80 ? "#16C784" : p >= 50 ? "#F59E0B" : "#F0454E");
const bandLevel = (p) => (p >= 100 ? 4 : p >= 67 ? 3 : p >= 34 ? 2 : p > 0 ? 1 : 0);

/* ================================================================== */
export default function App({ isAdmin = false, enrolled: enrolledProp = false, mentorName: mentorNameProp = null }) {
  const [trades, setTrades] = useState([]);
  const [frameworks, setFrameworks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [activeAcc, setActiveAcc] = useState("");
  const [editingAccounts, setEditingAccounts] = useState(false);
  const [editingImport, setEditingImport] = useState(false);
  const [chartFor, setChartFor] = useState(null);
  const [dashMode, setDashMode] = useState("$");
  const [dailyNotes, setDailyNotes] = useState({});
  const [notebook, setNotebook] = useState({ folders: [], notes: [] });
  const [progress, setProgress] = useState({ rules: [], log: {} });
  const [editingRules, setEditingRules] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [editingFolder, setEditingFolder] = useState(null);
  const [view, setView] = useState("dashboard");
  const [editing, setEditing] = useState(null);
  const [editingFw, setEditingFw] = useState(null);
  const [query, setQuery] = useState("");
  const [fwFilter, setFwFilter] = useState("");
  const [dirFilter, setDirFilter] = useState("");
  // mentoring
  const [enrolled, setEnrolled] = useState(enrolledProp);
  const [mentorName, setMentorName] = useState(mentorNameProp);
  const [mentorPlans, setMentorPlans] = useState([]);
  const [mentorTrades, setMentorTrades] = useState([]);
  const [mentorTab, setMentorTab] = useState("plans");
  const [editingMTrade, setEditingMTrade] = useState(null);
  const [editingMImport, setEditingMImport] = useState(false);
  const [instrumentsList, setInstrumentsList] = useState([]);

  /* načtení + migrace setup -> framework + účty */
  useEffect(() => {
    (async () => {
      let tr = []; let fw = []; let defaultCur = "$";
      try { tr = JSON.parse((await store.get(T_KEY)) || "[]"); } catch {}
      try { fw = JSON.parse((await store.get(F_KEY)) || "[]"); } catch {}
      try { const s = JSON.parse((await store.get(S_KEY)) || "{}"); if (s.cur) defaultCur = s.cur; } catch {}
      try { setDailyNotes(JSON.parse((await store.get(N_KEY)) || "{}")); } catch {}
      let nb = null; try { nb = JSON.parse((await store.get(NB_KEY)) || "null"); } catch {}
      if (!nb || !nb.folders || nb.folders.length === 0) { nb = { folders: seedFolders(), notes: (nb && nb.notes) || [] }; store.set(NB_KEY, JSON.stringify(nb)); }
      setNotebook(nb);
      let pg = null; try { pg = JSON.parse((await store.get(P_KEY)) || "null"); } catch {}
      if (!pg || !pg.rules || pg.rules.length === 0) { pg = { rules: seedRules(), log: (pg && pg.log) || {} }; store.set(P_KEY, JSON.stringify(pg)); }
      setProgress(pg);
      try { const dm = await store.get(D_KEY); if (dm === "$" || dm === "R") setDashMode(dm); } catch {}
      try { const ir = await fetch("/api/instruments"); if (ir.ok) { const id = await ir.json(); setInstruments(id.instruments || []); setInstrumentsList(id.instruments || []); } } catch {}

      // přenos dat ze starší verze (klíče journal:*), pokud tu ještě nic není
      if (tr.length === 0) {
        try { const old = JSON.parse((await store.get("journal:trades:v1")) || "[]"); if (old.length) tr = old; } catch {}
        try { const os = JSON.parse((await store.get("journal:settings:v1")) || "{}"); if (os.cur) defaultCur = os.cur; } catch {}
      }

      const byName = {}; fw.forEach((f) => (byName[f.name.toLowerCase()] = f));
      let dirty = false, ci = fw.length;
      tr = tr.map((t) => {
        if (!t.frameworkId && t.setup) {
          const key = t.setup.toLowerCase();
          let f = byName[key];
          if (!f) { f = { id: uid(), name: t.setup, description: "", color: FW_COLORS[ci++ % FW_COLORS.length], rules: [] }; fw.push(f); byName[key] = f; dirty = true; }
          return { ...t, frameworkId: f.id };
        }
        return t;
      });

      // účty
      let acc = null; try { acc = JSON.parse((await store.get(A_KEY)) || "null"); } catch {}
      if (!acc || !acc.accounts || acc.accounts.length === 0) {
        const def = { id: uid(), name: "Hlavní účet", currency: defaultCur };
        acc = { accounts: [def], activeId: def.id };
        store.set(A_KEY, JSON.stringify(acc));
      }
      const firstAcc = acc.accounts[0].id;
      let accDirty = false;
      tr = tr.map((t) => { if (!t.accountId) { accDirty = true; return { ...t, accountId: firstAcc }; } return t; });
      setAccounts(acc.accounts);
      setActiveAcc(acc.accounts.some((a) => a.id === acc.activeId) ? acc.activeId : firstAcc);

      setTrades(tr); setFrameworks(fw); setLoaded(true);
      if (dirty || accDirty) { store.set(T_KEY, JSON.stringify(tr)); store.set(F_KEY, JSON.stringify(fw)); }
    })();
  }, []);

  const persistT = useCallback((next) => { setTrades(next); store.set(T_KEY, JSON.stringify(next)); }, []);
  const persistF = useCallback((next) => { setFrameworks(next); store.set(F_KEY, JSON.stringify(next)); }, []);

  // mentoring: načtení dat, když je student zapsaný
  useEffect(() => {
    if (!enrolled) return;
    (async () => {
      try { const v = JSON.parse((await store.get(MP_KEY)) || "[]"); setMentorPlans(Array.isArray(v) ? v : []); } catch {}
      try { setMentorTrades(JSON.parse((await store.get(MT_KEY)) || "[]") || []); } catch {}
    })();
  }, [enrolled]);

  const persistMentorPlans = useCallback((next) => { setMentorPlans(next); store.set(MP_KEY, JSON.stringify(next)); }, []);
  const persistMentorTrades = useCallback((next) => { setMentorTrades(next); store.set(MT_KEY, JSON.stringify(next)); }, []);

  const blankPlan = () => ({
    id: uid(), date: new Date().toISOString().slice(0, 10), symbol: "", frameworkId: "",
    weekly: { note: "", shots: [] }, daily: { note: "", shots: [] }, auction: { note: "", shots: [] },
    description: "", outcome: "", adherence: "", lessons: "", debriefShots: [], createdAt: null,
  });
  const newMentorPlan = () => { persistMentorPlans([blankPlan(), ...mentorPlans]); };
  const saveMentorPlan = (id, patch) => {
    persistMentorPlans(mentorPlans.map((p) => (p.id === id
      ? { ...p, ...patch, createdAt: p.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }
      : p)));
  };
  const deleteMentorPlan = (id) => { if (window.confirm("Smazat tento obchodní plán?")) persistMentorPlans(mentorPlans.filter((p) => p.id !== id)); };
  const saveMentorTrade = (t) => {
    const exists = mentorTrades.some((x) => x.id === t.id);
    persistMentorTrades(exists ? mentorTrades.map((x) => (x.id === t.id ? t : x)) : [t, ...mentorTrades]);
    setEditingMTrade(null);
  };
  const deleteMentorTrade = (id) => { if (window.confirm("Smazat dozorovaný obchod?")) persistMentorTrades(mentorTrades.filter((x) => x.id !== id)); };

  const redeemCode = async (code) => {
    try {
      const r = await fetch("/api/mentor/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { error: d.error || "Nepodařilo se připojit." };
      setEnrolled(true); setMentorName(d.mentorName || "Mentor");
      return { ok: true };
    } catch { return { error: "Chyba spojení." }; }
  };

  const switchAccount = (id) => { setActiveAcc(id); store.set(A_KEY, JSON.stringify({ accounts, activeId: id })); };
  const saveAccounts = (next) => {
    const ids = new Set(next.map((a) => a.id));
    const fallback = next[0]?.id;
    if (fallback) {
      const reassigned = trades.map((t) => (ids.has(t.accountId) ? t : { ...t, accountId: fallback }));
      if (reassigned.some((t, i) => t !== trades[i])) persistT(reassigned);
    }
    const aid = next.some((a) => a.id === activeAcc) ? activeAcc : fallback;
    setAccounts(next); setActiveAcc(aid);
    store.set(A_KEY, JSON.stringify({ accounts: next, activeId: aid }));
    setEditingAccounts(false);
  };

  const saveNote = (key, text) => {
    setDailyNotes((prev) => { const next = { ...prev, [key]: text }; store.set(N_KEY, JSON.stringify(next)); return next; });
  };

  const persistNB = useCallback((next) => { setNotebook(next); store.set(NB_KEY, JSON.stringify(next)); }, []);
  const saveNbNote = (n) => {
    const note = { ...n, updatedAt: Date.now() };
    const exists = notebook.notes.some((x) => x.id === n.id);
    persistNB({ ...notebook, notes: exists ? notebook.notes.map((x) => x.id === n.id ? note : x) : [note, ...notebook.notes] });
    setEditingNote(null);
  };
  const deleteNbNote = (id) => { if (window.confirm("Smazat poznámku?")) persistNB({ ...notebook, notes: notebook.notes.filter((x) => x.id !== id) }); };
  const saveFolder = (f) => {
    const exists = notebook.folders.some((x) => x.id === f.id);
    persistNB({ ...notebook, folders: exists ? notebook.folders.map((x) => x.id === f.id ? f : x) : [...notebook.folders, f] });
    setEditingFolder(null);
  };
  const deleteFolder = (id) => {
    if (!window.confirm("Smazat složku? Poznámky zůstanou, jen se přesunou do „Bez složky\".")) return;
    persistNB({ folders: notebook.folders.filter((x) => x.id !== id), notes: notebook.notes.map((n) => n.folderId === id ? { ...n, folderId: "" } : n) });
    setEditingFolder(null);
  };

  const persistP = useCallback((next) => { setProgress(next); store.set(P_KEY, JSON.stringify(next)); }, []);
  const toggleRuleDay = (dateKey, ruleId) => {
    const log = { ...(progress.log || {}) };
    const day = { ...(log[dateKey] || {}) };
    day[ruleId] = !day[ruleId];
    log[dateKey] = day;
    persistP({ ...progress, log });
  };
  const saveRules = (rules) => persistP({ ...progress, rules });

  const saveTrade = (t) => {
    persistT(trades.some((x) => x.id === t.id) ? trades.map((x) => x.id === t.id ? t : x) : [...trades, t]);
    setEditing(null);
  };
  const deleteTrade = (id) => { if (window.confirm("Smazat tento obchod?")) persistT(trades.filter((x) => x.id !== id)); };

  const changeDashMode = (m) => { setDashMode(m); store.set(D_KEY, m); };

  const importTrades = (rows, mapping) => {
    let fws = [...frameworks];
    const fwByName = {}; fws.forEach((f) => (fwByName[f.name.toLowerCase()] = f));
    const getFw = (name) => {
      const k = (name || "").trim().toLowerCase(); if (!k) return "";
      let f = fwByName[k];
      if (!f) { f = { id: uid(), name: name.trim(), description: "", color: FW_COLORS[fws.length % FW_COLORS.length], rules: [] }; fws.push(f); fwByName[k] = f; }
      return f.id;
    };
    const made = rows.map((row) => {
      const get = (field) => (mapping[field] ? row[mapping[field]] : "");
      const t = blankTrade(); t.accountId = activeAcc;
      const rawDate = get("date"); const d = rawDate ? new Date(rawDate) : new Date();
      t.date = isNaN(d) ? toLocalInput(new Date()) : toLocalInput(d);
      t.symbol = String(get("symbol") || "").trim();
      const dv = String(get("direction") || "").trim().toLowerCase();
      t.direction = (dv.includes("short") || dv.includes("sell") || dv === "s") ? "short" : "long";
      t.entryPrice = parseNumStr(get("entryPrice")); t.exitPrice = parseNumStr(get("exitPrice")); t.quantity = parseNumStr(get("quantity"));
      t.stopLoss = parseNumStr(get("stopLoss")); t.fees = parseNumStr(get("fees")); t.pnl = parseNumStr(get("pnl"));
      t.mae = parseNumStr(get("mae")); t.mfe = parseNumStr(get("mfe"));
      t.notes = String(get("notes") || "");
      const tagsRaw = String(get("tags") || ""); t.tags = tagsRaw ? tagsRaw.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : [];
      const pb = String(get("playbook") || ""); if (pb) t.frameworkId = getFw(pb);
      t.source = "imported";
      return t;
    });
    if (fws.length !== frameworks.length) persistF(fws);
    persistT([...trades, ...made]);
    setEditingImport(false);
    return made.length;
  };

  const importNinjaTrades = (rawRows) => {
    let fws = [...frameworks];
    const fwByName = {}; fws.forEach((f) => (fwByName[f.name.toLowerCase()] = f));
    const getFw = (name) => {
      const k = (name || "").trim().toLowerCase(); if (!k) return "";
      let f = fwByName[k];
      if (!f) { f = { id: uid(), name: name.trim(), description: "", color: FW_COLORS[fws.length % FW_COLORS.length], rules: [] }; fws.push(f); fwByName[k] = f; }
      return f.id;
    };
    const grouped = groupNinjaTrades(rawRows);
    const made = grouped.map((g) => {
      const t = blankTrade(); t.accountId = activeAcc;
      t.symbol = g.symbol; t.direction = g.direction; t.quantity = g.quantity;
      t.entryPrice = g.entryPrice; t.exitPrice = g.exitPrice;
      t.date = g.date ? toLocalInput(g.date) : toLocalInput(new Date());
      t.fees = g.fees; t.mae = g.mae; t.mfe = g.mfe; t.pnl = g.pnl;
      t.reviewed = false;
      if (g.strategy) t.frameworkId = getFw(g.strategy);
      t.source = "imported";
      return t;
    });
    if (fws.length !== frameworks.length) persistF(fws);
    persistT([...trades, ...made]);
    setEditingImport(false);
    return made.length;
  };

  // Import do DOZOROVANÝCH obchodů (mentoring) — vždy "importováno", nelze zadat ručně
  const buildFromNinja = (rawRows) => {
    let fws = [...frameworks];
    const fwByName = {}; fws.forEach((f) => (fwByName[f.name.toLowerCase()] = f));
    const getFw = (name) => {
      const k = (name || "").trim().toLowerCase(); if (!k) return "";
      let f = fwByName[k];
      if (!f) { f = { id: uid(), name: name.trim(), description: "", color: FW_COLORS[fws.length % FW_COLORS.length], rules: [] }; fws.push(f); fwByName[k] = f; }
      return f.id;
    };
    const made = groupNinjaTrades(rawRows).map((g) => {
      const t = blankTrade(); t.accountId = activeAcc;
      t.symbol = g.symbol; t.direction = g.direction; t.quantity = g.quantity;
      t.entryPrice = g.entryPrice; t.exitPrice = g.exitPrice;
      t.date = g.date ? toLocalInput(g.date) : toLocalInput(new Date());
      t.fees = g.fees; t.mae = g.mae; t.mfe = g.mfe; t.pnl = g.pnl;
      if (g.strategy) t.frameworkId = getFw(g.strategy);
      t.source = "imported";
      return t;
    });
    if (fws.length !== frameworks.length) persistF(fws);
    return made;
  };
  const importNinjaToMentor = (rawRows) => {
    const made = buildFromNinja(rawRows);
    persistMentorTrades([...made, ...mentorTrades]);
    setEditingMImport(false);
    return made.length;
  };
  const importCsvToMentor = (rows, mapping) => {
    let fws = [...frameworks];
    const fwByName = {}; fws.forEach((f) => (fwByName[f.name.toLowerCase()] = f));
    const getFw = (name) => {
      const k = (name || "").trim().toLowerCase(); if (!k) return "";
      let f = fwByName[k];
      if (!f) { f = { id: uid(), name: name.trim(), description: "", color: FW_COLORS[fws.length % FW_COLORS.length], rules: [] }; fws.push(f); fwByName[k] = f; }
      return f.id;
    };
    const made = rows.map((row) => {
      const get = (field) => (mapping[field] ? row[mapping[field]] : "");
      const t = blankTrade(); t.accountId = activeAcc;
      const rawDate = get("date"); const d = rawDate ? new Date(rawDate) : new Date();
      t.date = isNaN(d) ? toLocalInput(new Date()) : toLocalInput(d);
      t.symbol = String(get("symbol") || "").trim();
      const dv = String(get("direction") || "").trim().toLowerCase();
      t.direction = (dv.includes("short") || dv.includes("sell") || dv === "s") ? "short" : "long";
      t.entryPrice = parseNumStr(get("entryPrice")); t.exitPrice = parseNumStr(get("exitPrice")); t.quantity = parseNumStr(get("quantity"));
      t.stopLoss = parseNumStr(get("stopLoss")); t.fees = parseNumStr(get("fees")); t.pnl = parseNumStr(get("pnl"));
      t.mae = parseNumStr(get("mae")); t.mfe = parseNumStr(get("mfe"));
      const pb = String(get("playbook") || ""); if (pb) t.frameworkId = getFw(pb);
      t.source = "imported";
      return t;
    });
    if (fws.length !== frameworks.length) persistF(fws);
    persistMentorTrades([...made, ...mentorTrades]);
    setEditingMImport(false);
    return made.length;
  };

  const createFramework = (name) => {
    const f = { id: uid(), name, description: "", color: FW_COLORS[frameworks.length % FW_COLORS.length], rules: [] };
    persistF([...frameworks, f]); return f.id;
  };
  const saveFramework = (f) => {
    persistF(frameworks.some((x) => x.id === f.id) ? frameworks.map((x) => x.id === f.id ? f : x) : [...frameworks, f]);
    setEditingFw(null);
  };
  const deleteFramework = (id) => {
    if (!window.confirm("Smazat playbook? Obchody zůstanou, jen ztratí přiřazení.")) return;
    persistF(frameworks.filter((x) => x.id !== id));
    persistT(trades.map((t) => t.frameworkId === id ? { ...t, frameworkId: "" } : t));
  };

  const fwById = useMemo(() => Object.fromEntries(frameworks.map((f) => [f.id, f])), [frameworks]);
  const activeAccount = useMemo(() => accounts.find((a) => a.id === activeAcc), [accounts, activeAcc]);
  const cur = activeAccount?.currency || "$";
  const newTrade = () => ({ ...blankTrade(), accountId: activeAcc });
  const accountTrades = useMemo(() => trades.filter((t) => t.accountId === activeAcc), [trades, activeAcc]);

  const filtered = useMemo(() => accountTrades.filter((t) => {
    if (query && !`${t.symbol} ${t.notes} ${fwById[t.frameworkId]?.name || ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (fwFilter && t.frameworkId !== fwFilter) return false;
    if (dirFilter && t.direction !== dirFilter) return false;
    return true;
  }), [accountTrades, query, fwFilter, dirFilter, fwById]);

  const realTrades = useMemo(() => accountTrades.filter((t) => !t.missed), [accountTrades]);
  const stats = useMemo(() => computeStats(realTrades), [realTrades]);

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "dailyjournal", label: "Deník", icon: ClipboardList },
    { id: "journal", label: "Obchody", icon: BookOpen },
    { id: "notebook", label: "Notebook", icon: NotebookText },
    { id: "reports", label: "Reports", icon: BarChart3 },
    { id: "calendar", label: "Kalendář", icon: CalendarDays },
    { id: "frameworks", label: "Playbooks", icon: Layers },
    { id: "progress", label: "Progress", icon: ListChecks },
    ...(!isAdmin ? [{ id: "mentoring", label: "Mentoring", icon: enrolled ? GraduationCap : Lock }] : []),
  ];

  return (
    <div className="tz">
      <Style />
      {/* sidebar */}
      <aside className="side">
        <div className="brand"><img className="brand-logo" src="/real-edge-logo.png" alt="REAL EDGE" /></div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={`nav-i ${view === n.id ? "on" : ""}`} onClick={() => setView(n.id)}>
              <n.icon size={18} /> <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="acc-switch">
            <select value={activeAcc} onChange={(e) => switchAccount(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
            </select>
            <button className="acc-gear" onClick={() => setEditingAccounts(true)} title="Spravovat účty"><Settings size={15} /></button>
          </div>
        </div>
      </aside>

      {/* main */}
      <div className="content">
        <header className="topbar">
          <h1>{NAV.find((n) => n.id === view)?.label}</h1>
          <button className="btn primary" onClick={() => setEditing(newTrade())}><Plus size={16} /> Nový obchod</button>
        </header>

        {!loaded ? <div className="empty">Načítám…</div>
          : trades.length === 0 && view !== "frameworks" && view !== "dailyjournal" && view !== "notebook" && view !== "progress" && view !== "mentoring" ? <EmptyState onAdd={() => setEditing(newTrade())} onImport={() => setEditingImport(true)} />
          : view === "dashboard" ? <Dashboard stats={stats} trades={realTrades} cur={cur} fwById={fwById} onAdd={() => setEditing(newTrade())} mode={dashMode} onMode={changeDashMode} />
          : view === "dailyjournal" ? (
            <DailyJournalView trades={realTrades} fwById={fwById} cur={cur} notes={dailyNotes} onSaveNote={saveNote} onEditTrade={(t) => setEditing({ ...t })} onAdd={() => setEditing(newTrade())} />
          )
          : view === "journal" ? (
            <JournalView
              trades={filtered} fwById={fwById} cur={cur} frameworks={frameworks}
              query={query} setQuery={setQuery} fwFilter={fwFilter} setFwFilter={setFwFilter}
              dirFilter={dirFilter} setDirFilter={setDirFilter}
              total={accountTrades.length} onEdit={(t) => setEditing({ ...t })} onDelete={deleteTrade}
              onImport={() => setEditingImport(true)}
              onChart={(t) => setChartFor({ symbol: t.symbol, date: t.date })}
            />
          )
          : view === "notebook" ? (
            <NotebookView notebook={notebook}
              onNewNote={(fid) => setEditingNote({ ...blankNote(), folderId: fid || "" })}
              onEditNote={(n) => setEditingNote({ ...n })} onDeleteNote={deleteNbNote}
              onNewFolder={() => setEditingFolder(blankFolder())} onEditFolder={(f) => setEditingFolder({ ...f })} />
          )
          : view === "calendar" ? <CalendarView trades={realTrades} cur={cur} />
          : view === "reports" ? <ReportsView trades={realTrades} frameworks={frameworks} fwById={fwById} cur={cur} />
          : view === "frameworks" ? <FrameworksView frameworks={frameworks} trades={accountTrades} cur={cur}
              onNew={() => setEditingFw(blankFw())} onEdit={(f) => setEditingFw({ ...f })} onDelete={deleteFramework} />
          : view === "mentoring" ? (
            !enrolled ? <RedeemScreen onRedeem={redeemCode} />
            : <MentoringView
                plans={mentorPlans} mtrades={mentorTrades} fwById={fwById} frameworks={frameworks} instruments={instrumentsList} cur={cur} mentorName={mentorName}
                tab={mentorTab} setTab={setMentorTab}
                onSavePlan={saveMentorPlan} onNewPlan={newMentorPlan} onDeletePlan={deleteMentorPlan}
                onImportTrades={() => setEditingMImport(true)} onDeleteTrade={deleteMentorTrade} />
          )
          : <ProgressView progress={progress} trades={realTrades} onToggle={toggleRuleDay} onEditRules={() => setEditingRules(true)} />}
      </div>

      {editing && (
        <TradeForm cur={cur} initial={editing} frameworks={frameworks}
          onCancel={() => setEditing(null)} onSave={saveTrade} onCreateFramework={createFramework}
          onShowChart={(t) => setChartFor({ symbol: t.symbol, date: t.date })} />
      )}
      {editingFw && (
        <FrameworkForm initial={editingFw} onCancel={() => setEditingFw(null)} onSave={saveFramework} />
      )}
      {editingNote && (
        <NoteForm initial={editingNote} folders={notebook.folders} onSave={saveNbNote} onCancel={() => setEditingNote(null)} />
      )}
      {editingFolder && (
        <FolderForm initial={editingFolder} onSave={saveFolder} onCancel={() => setEditingFolder(null)} onDelete={deleteFolder} />
      )}
      {editingRules && (
        <RulesForm initial={progress.rules} onSave={(r) => { saveRules(r); setEditingRules(false); }} onCancel={() => setEditingRules(false)} />
      )}
      {editingAccounts && (
        <AccountsForm initial={accounts} hasTradesFor={(id) => trades.some((t) => t.accountId === id)} onSave={saveAccounts} onCancel={() => setEditingAccounts(false)} />
      )}
      {editingImport && (
        <ImportForm onImport={importTrades} onImportNinja={importNinjaTrades} onCancel={() => setEditingImport(false)} />
      )}
      {editingMTrade && (
        <TradeForm cur={cur} initial={editingMTrade} frameworks={frameworks}
          onCancel={() => setEditingMTrade(null)} onSave={saveMentorTrade} onCreateFramework={createFramework}
          onShowChart={(t) => setChartFor({ symbol: t.symbol, date: t.date })} />
      )}
      {editingMImport && (
        <ImportForm onImport={importCsvToMentor} onImportNinja={importNinjaToMentor} onCancel={() => setEditingMImport(false)} />
      )}
      {chartFor && (
        <ChartModal symbol={chartFor.symbol} date={chartFor.date} onClose={() => setChartFor(null)} />
      )}
    </div>
  );
}

/* ========================= DASHBOARD ========================= */
function Dashboard({ stats, trades, cur, fwById, onAdd, mode, onMode }) {
  const score = overallScore(stats);
  const axes = scoreAxes(stats);
  const { curve } = useMemo(() => equityAndDD(trades), [trades]);
  const recent = useMemo(() => [...trades].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5), [trades]);
  const scoreColor = score >= 70 ? "#16C784" : score >= 45 ? "#F59E0B" : "#F0454E";

  const isR = mode === "R";
  const rVals = useMemo(() => trades.map(computeR), [trades]);
  const sumR = rVals.reduce((a, r) => a + (r || 0), 0);
  const realR = rVals.filter((r) => r !== null);
  const avgR = realR.length ? realR.reduce((a, b) => a + b, 0) / realR.length : 0;
  const curveR = useMemo(() => {
    let acc = 0; const pts = [{ i: 0, equity: 0, label: "Start" }];
    [...trades].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((t, i) => { acc += (computeR(t) || 0); pts.push({ i: i + 1, equity: acc, label: t.symbol || `#${i + 1}` }); });
    return pts;
  }, [trades]);
  const eqCurve = isR ? curveR : curve;
  const eqPos = isR ? sumR >= 0 : stats.net >= 0;
  const eqColor = eqPos ? "#16C784" : "#F0454E";
  const netDisplay = isR ? `${sumR >= 0 ? "+" : ""}${fmtNum(sumR, 1)}R` : fmtMoney(stats.net, cur);
  const expDisplay = isR ? `${avgR >= 0 ? "+" : ""}${fmtNum(avgR, 2)}R` : fmtMoney(stats.expectancy, cur);

  // ověřené vs ruční + MAE/MFE
  const verif = useMemo(() => {
    let imported = 0, manual = 0;
    trades.forEach((t) => { if (t.source === "imported") imported++; else manual++; });
    const total = imported + manual;
    return { imported, manual, total, pct: total ? Math.round((imported / total) * 100) : 100 };
  }, [trades]);
  const mm = useMemo(() => {
    let sMae = 0, nMae = 0, sMfe = 0, nMfe = 0;
    trades.forEach((t) => {
      const a = num(t.mae), f = num(t.mfe);
      if (isFinite(a)) { sMae += Math.abs(a); nMae++; }
      if (isFinite(f)) { sMfe += Math.abs(f); nMfe++; }
    });
    const avgMae = nMae ? sMae / nMae : null;
    const avgMfe = nMfe ? sMfe / nMfe : null;
    const eff = nMfe && sMfe > 0 ? Math.max(0, Math.min(100, (stats.net / sMfe) * 100)) : null;
    return { avgMae, avgMfe, eff, has: nMae > 0 || nMfe > 0 };
  }, [trades, stats.net]);

  return (
    <div className="grid-dash">
      <div className={`verif-strip ${verif.manual > 0 ? "warn" : "ok"}`}>
        {verif.manual > 0 ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}
        <div className="vs-text">
          <b>{verif.manual > 0 ? `Pozor — ${verif.manual} ${verif.manual === 1 ? "ruční obchod" : verif.manual <= 4 ? "ruční obchody" : "ručních obchodů"}` : "Vše ověřeno importem"}</b>
          <span>{verif.imported} importovaných · {verif.manual} ručních</span>
        </div>
        <div className="vs-pct">
          <span className="vs-bar"><i style={{ width: `${verif.pct}%` }} /></span>
          <b>{verif.pct} % ověřeno</b>
        </div>
      </div>

      <div className="card score-card">
        <div className="card-h">Zella Score</div>
        <div className="score-body">
          <Gauge value={score} color={scoreColor} />
          <div className="radar"><ResponsiveContainer width="100%" height={180}>
            <RadarChart data={axes} outerRadius={68}>
              <PolarGrid stroke="#E8EAF1" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: "#8A90A2", fontSize: 10 }} />
              <Radar dataKey="value" stroke="#17386F" fill="#17386F" fillOpacity={0.22} />
            </RadarChart>
          </ResponsiveContainer></div>
        </div>
      </div>

      <div className="kpis">
        <Kpi label={isR ? "Net R" : "Net P&L"} value={netDisplay} tone={eqPos ? "pos" : "neg"} big />
        <Kpi label="Win rate" value={`${fmtNum(stats.winRate, 1)} %`} sub={`${stats.wins}W / ${stats.losses}L`} />
        <Kpi label="Profit factor" value={stats.profitFactor === Infinity ? "∞" : fmtNum(stats.profitFactor)} />
        <Kpi label="Expectancy" value={expDisplay} tone={(isR ? avgR : stats.expectancy) >= 0 ? "pos" : "neg"} sub="na obchod" />
        <Kpi label="Max drawdown" value={fmtMoney(-stats.maxDD, cur)} tone="neg" />
        <Kpi label="Prům. W/L" value={`${fmtMoney(stats.avgWin, cur)} / ${fmtMoney(-stats.avgLoss, cur)}`} />
        {mm.avgMfe != null && <Kpi label="Ø MFE" value={fmtMoney(mm.avgMfe, cur)} tone="pos" sub="max pro tebe" />}
        {mm.avgMae != null && <Kpi label="Ø MAE" value={fmtMoney(-mm.avgMae, cur)} tone="neg" sub="max proti" />}
        {mm.eff != null && <Kpi label="Efektivita" value={`${fmtNum(mm.eff, 0)} %`} sub="z příznivého pohybu" />}
      </div>

      <div className="card equity-card">
        <div className="card-h eq-head">
          <span>Equity křivka <span className="muted">· {stats.n} {pluralObchod(stats.n)}</span></span>
          <div className="seg sm-seg">
            <button className={`seg-btn ${!isR ? "on" : ""}`} onClick={() => onMode("$")}>{cur}</button>
            <button className={`seg-btn ${isR ? "on" : ""}`} onClick={() => onMode("R")}>R</button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={eqCurve} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={eqColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={eqColor} stopOpacity={0} />
            </linearGradient></defs>
            <XAxis dataKey="i" hide />
            <YAxis width={62} tick={{ fill: "#8A90A2", fontSize: 11 }} axisLine={false} tickLine={false}
              tickFormatter={(v) => (isR ? `${v.toFixed(0)}R` : cur + v.toLocaleString("en-US"))} />
            <ReferenceLine y={0} stroke="#E8EAF1" />
            <Tooltip content={<EqTip cur={cur} isR={isR} />} />
            <Area type="monotone" dataKey="equity" stroke={eqColor} strokeWidth={2.5} fill="url(#eg)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card recent-card">
        <div className="card-h">Poslední obchody</div>
        <div className="recent-list">
          {recent.map((t) => {
            const p = computePnl(t), f = fwById[t.frameworkId], r = computeR(t);
            return (
              <div className="recent-row" key={t.id}>
                <div className="rr-l">
                  <span className={`pill ${t.direction}`}>{t.direction === "long" ? "L" : "S"}</span>
                  <div><div className="rr-sym">{t.symbol || "—"}</div>
                    <div className="rr-meta">{f ? <><i className="fdot" style={{ background: f.color }} />{f.name}</> : "—"}</div></div>
                </div>
                <div className={`rr-pnl ${p >= 0 ? "pos" : "neg"}`}>{isR ? (r === null ? "—" : `${r >= 0 ? "+" : ""}${fmtNum(r, 1)}R`) : fmtMoney(p, cur)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Gauge({ value, color }) {
  const R = 52, C = 2 * Math.PI * R, dash = (value / 100) * C;
  return (
    <div className="gauge">
      <svg viewBox="0 0 130 130" width="148" height="148">
        <circle cx="65" cy="65" r={R} fill="none" stroke="#EEF0F6" strokeWidth="11" />
        <circle cx="65" cy="65" r={R} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`} transform="rotate(-90 65 65)" />
        <text x="65" y="62" textAnchor="middle" className="g-num" fill={color}>{value}</text>
        <text x="65" y="82" textAnchor="middle" className="g-lbl">/ 100</text>
      </svg>
    </div>
  );
}

function Kpi({ label, value, sub, tone = "", big }) {
  return (
    <div className={`card kpi ${big ? "kpi-big" : ""}`}>
      <div className="kpi-l">{label}</div>
      <div className={`kpi-v ${tone}`}>{value}</div>
      {sub && <div className="kpi-s">{sub}</div>}
    </div>
  );
}
function EqTip({ active, payload, cur, isR }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return <div className="tip"><div className="tip-l">{p.label}</div>
    <div className={`tip-v ${p.equity >= 0 ? "pos" : "neg"}`}>{isR ? `${p.equity >= 0 ? "+" : ""}${fmtNum(p.equity, 1)}R` : fmtMoney(p.equity, cur)}</div></div>;
}

/* ========================= JOURNAL ========================= */
function JournalView({ trades, fwById, cur, frameworks, query, setQuery, fwFilter, setFwFilter, dirFilter, setDirFilter, total, onEdit, onDelete, onImport, onChart }) {
  const sorted = useMemo(() => [...trades].sort((a, b) => new Date(b.date) - new Date(a.date)), [trades]);
  return (
    <div className="stack">
      <div className="filters">
        <div className="search"><Search size={15} />
          <input placeholder="Hledat symbol, playbook, poznámku…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <select value={fwFilter} onChange={(e) => setFwFilter(e.target.value)}>
          <option value="">Všechny playbooky</option>
          {frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={dirFilter} onChange={(e) => setDirFilter(e.target.value)}>
          <option value="">Long i Short</option><option value="long">Long</option><option value="short">Short</option>
        </select>
        {(query || fwFilter || dirFilter) && <button className="btn ghost" onClick={() => { setQuery(""); setFwFilter(""); setDirFilter(""); }}><X size={14} /> Zrušit</button>}
        <button className="btn ghost" onClick={onImport}><FileText size={14} /> Import CSV</button>
        <div className="count">{sorted.length} / {total}</div>
      </div>

      <div className="card table-wrap">
        {sorted.length === 0 ? <div className="empty small">Žádný obchod neodpovídá filtru.</div> : (
          <table className="tbl">
            <thead><tr>
              <th>Datum</th><th>Symbol</th><th>Směr</th><th>Playbook</th>
              <th className="r">Vstup</th><th className="r">Výstup</th><th className="r">Velikost</th>
              <th className="r">R</th><th className="r">P&L</th><th></th>
            </tr></thead>
            <tbody>
              {sorted.map((t) => {
                const p = computePnl(t), r = computeR(t), f = fwById[t.frameworkId];
                return (
                  <tr key={t.id} className={t.missed ? "row-missed" : ""} onClick={() => onEdit(t)}>
                    <td className="mut">{fmtDate(t.date)}</td>
                    <td className="sym">
                      {t.symbol || "—"}
                      {t.reviewed && <Check size={13} className="rev-check" />}
                      {t.source === "imported"
                        ? <span className="src-badge imp" title="Importováno z platformy"><ShieldCheck size={11} /></span>
                        : <span className="src-badge man" title="Zadáno ručně"><Pencil size={11} /></span>}
                    </td>
                    <td><span className={`dir ${t.direction}`}>{t.direction === "long" ? "LONG" : "SHORT"}</span></td>
                    <td>
                      <span className="cellflags">
                        {f ? <span className="fwtag"><i style={{ background: f.color }} />{f.name}</span> : <span className="mut">—</span>}
                        {t.rating && <span className="rtag">{t.rating}</span>}
                        {t.missed && <span className="missbadge">MISS</span>}
                      </span>
                    </td>
                    <td className="r n">{t.entryPrice || "—"}</td><td className="r n">{t.exitPrice || "—"}</td><td className="r n">{t.quantity || "—"}</td>
                    <td className={`r n ${r === null ? "mut" : r >= 0 ? "pos" : "neg"}`}>{r === null ? "—" : `${r >= 0 ? "+" : ""}${fmtNum(r, 1)}R`}</td>
                    <td className={`r n strong ${t.missed ? "mut" : p >= 0 ? "pos" : "neg"}`}>{fmtMoney(p, cur)}</td>
                    <td className="act" onClick={(e) => e.stopPropagation()}>
                      <button title="Graf" onClick={() => onChart(t)}><BarChart3 size={14} /></button>
                      <button title="Upravit" onClick={() => onEdit(t)}><Pencil size={14} /></button>
                      <button title="Smazat" onClick={() => onDelete(t.id)}><Trash2 size={14} /></button>
                    </td>
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

/* ========================= DAILY JOURNAL ========================= */
function DailyJournalView({ trades, fwById, cur, notes, onSaveNote, onEditTrade, onAdd }) {
  const days = useMemo(() => {
    const map = {};
    trades.forEach((t) => { const k = dayKey(t.date); if (!k) return; (map[k] = map[k] || []).push(t); });
    const todayK = new Date().toISOString().slice(0, 10);
    if (!map[todayK]) map[todayK] = [];
    return Object.keys(map).sort((a, b) => (a < b ? 1 : -1)).map((k) => ({ key: k, trades: map[k] }));
  }, [trades]);

  return (
    <div className="stack dj">
      <p className="dj-intro">Den po dni: výsledky, obchody toho dne a tvoje poznámky (pre-market plán, recap, co se povedlo a co příště jinak).</p>
      {days.map((d) => (
        <DayCard key={d.key} dk={d.key} trades={d.trades} fwById={fwById} cur={cur}
          note={notes[d.key] || ""} onSaveNote={onSaveNote} onEditTrade={onEditTrade} onAdd={onAdd} />
      ))}
    </div>
  );
}

const DAY_TEMPLATE =
`📋 Pre-market plán:
- 

👀 Watchlist:
- 

✅ Co se povedlo:
- 

⚠️ Chyby:
- 

📝 Recap dne:
- `;

function DayCard({ dk, trades, fwById, cur, note, onSaveNote, onEditTrade, onAdd }) {
  const [draft, setDraft] = useState(note);
  useEffect(() => { setDraft(note); }, [note]);

  const s = computeStats(trades);
  const dt = new Date(dk + "T00:00:00");
  const weekday = dt.toLocaleDateString("cs-CZ", { weekday: "long" });
  const dateStr = dt.toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" });
  const isToday = dk === new Date().toISOString().slice(0, 10);
  const empty = trades.length === 0;
  const ordered = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));

  return (
    <div className="card day-card">
      <div className="day-head">
        <div className="day-when">
          <span className="day-wd">{weekday}{isToday && <span className="today-badge">dnes</span>}</span>
          <span className="day-date">{dateStr}</span>
        </div>
        {!empty && <div className={`day-pnl ${s.net >= 0 ? "pos" : "neg"}`}>{fmtMoney(s.net, cur)}</div>}
      </div>

      {!empty ? (
        <>
          <div className="day-stats">
            <div><span>Obchody</span><b>{s.n} <i className="wl">{s.wins}W/{s.losses}L</i></b></div>
            <div><span>Win rate</span><b>{fmtNum(s.winRate, 0)} %</b></div>
            <div><span>Profit factor</span><b>{s.profitFactor === Infinity ? "∞" : fmtNum(s.profitFactor)}</b></div>
            <div><span>Nej / nejhorší</span><b><span className="pos">{fmtCompact(s.best, cur)}</span> / <span className="neg">{fmtCompact(s.worst, cur)}</span></b></div>
          </div>
          <div className="day-trades">
            {ordered.map((t) => {
              const p = computePnl(t), r = computeR(t), f = fwById[t.frameworkId];
              return (
                <div className="dt-row" key={t.id} onClick={() => onEditTrade(t)}>
                  <span className={`pill ${t.direction}`}>{t.direction === "long" ? "L" : "S"}</span>
                  <span className="dt-time">{new Date(t.date).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="dt-sym">{t.symbol || "—"}</span>
                  <span className="dt-fw">{f ? <><i className="fdot" style={{ background: f.color }} />{f.name}</> : ""}</span>
                  <span className={`dt-r ${r === null ? "mut" : r >= 0 ? "pos" : "neg"}`}>{r === null ? "" : `${r >= 0 ? "+" : ""}${fmtNum(r, 1)}R`}</span>
                  <span className={`dt-pnl ${p >= 0 ? "pos" : "neg"}`}>{fmtMoney(p, cur)}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="day-empty">
          Zatím žádné obchody pro tento den. Napiš si pre-market plán dopředu — nebo <button className="linkbtn" onClick={onAdd}>přidej obchod</button>.
        </div>
      )}

      <div className="day-note">
        <div className="day-note-h">
          <span><FileText size={13} /> Poznámky k dni</span>
          {!draft.trim() && <button className="tmpl-btn" onClick={() => { setDraft(DAY_TEMPLATE); onSaveNote(dk, DAY_TEMPLATE); }}>Vložit šablonu</button>}
        </div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => onSaveNote(dk, draft)}
          placeholder="Pre-market plán, jak šel den, co se povedlo, co příště jinak…" rows={empty ? 4 : 3} />
      </div>
    </div>
  );
}

/* ========================= NOTEBOOK ========================= */
function fmtNoteDate(ts) { return ts ? new Date(ts).toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "2-digit" }) : ""; }

function NotebookView({ notebook, onNewNote, onEditNote, onDeleteNote, onNewFolder, onEditFolder }) {
  const { folders, notes } = notebook;
  const [active, setActive] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const fById = useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f])), [folders]);
  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags || []))].sort(), [notes]);

  const visible = useMemo(() => notes.filter((n) => {
    if (active && n.folderId !== active) return false;
    if (tag && !(n.tags || []).includes(tag)) return false;
    if (query && !`${n.title} ${n.body} ${(n.tags || []).join(" ")}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [notes, active, tag, query]);

  const countFor = (fid) => notes.filter((n) => n.folderId === fid).length;

  return (
    <div className="stack nb">
      <div className="nb-top">
        <div className="nb-folders">
          <button className={`fchip ${active === "" ? "on" : ""}`} onClick={() => setActive("")}>Vše <i>{notes.length}</i></button>
          {folders.map((f) => (
            <button key={f.id} className={`fchip ${active === f.id ? "on" : ""}`} onClick={() => setActive(f.id)}>
              <span className="fdot" style={{ background: f.color }} />{f.name} <i>{countFor(f.id)}</i>
            </button>
          ))}
          <button className="fchip add" onClick={onNewFolder}><Plus size={13} /> Složka</button>
        </div>
        <button className="btn primary" onClick={() => onNewNote(active)}><Plus size={16} /> Nová poznámka</button>
      </div>

      <div className="filters">
        <div className="search"><Search size={15} /><input placeholder="Hledat v poznámkách…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        {allTags.length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Všechny tagy</option>
            {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
          </select>
        )}
        {active && fById[active] && <button className="btn ghost" onClick={() => onEditFolder(fById[active])}><Pencil size={14} /> Upravit složku</button>}
      </div>

      {visible.length === 0 ? (
        <div className="card empty-card center">
          <NotebookText size={26} />
          <h2>Žádné poznámky</h2>
          <p>Notebook je tvůj prostor na pre-market plány, týdenní recapy, lekce a nápady. Složky můžou mít šablony, které se předvyplní.</p>
          <button className="btn primary" onClick={() => onNewNote(active)}><Plus size={16} /> Nová poznámka</button>
        </div>
      ) : (
        <div className="nb-grid">
          {visible.map((n) => {
            const f = fById[n.folderId];
            return (
              <div className="card note-card" key={n.id} onClick={() => onEditNote(n)}>
                <div className="note-h">
                  <span className="note-title">{n.title || "Bez názvu"}</span>
                  <button className="note-del" onClick={(e) => { e.stopPropagation(); onDeleteNote(n.id); }}><Trash2 size={13} /></button>
                </div>
                <p className="note-snip">{(n.body || "").trim().slice(0, 180) || "Prázdná poznámka"}</p>
                <div className="note-foot">
                  {f && <span className="note-folder"><i className="fdot" style={{ background: f.color }} />{f.name}</span>}
                  {(n.tags || []).slice(0, 3).map((t) => <span className="note-tag" key={t}>#{t}</span>)}
                  <span className="note-date">{fmtNoteDate(n.updatedAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NoteForm({ initial, folders, onSave, onCancel }) {
  const [n, setN] = useState(initial);
  const [tagInput, setTagInput] = useState("");
  const folder = folders.find((f) => f.id === n.folderId);
  const isEdit = initial.title || initial.body;

  const pickFolder = (e) => {
    const fid = e.target.value;
    const f = folders.find((x) => x.id === fid);
    setN((p) => ({ ...p, folderId: fid, body: (!p.body || !p.body.trim()) && f && f.template ? f.template : p.body }));
  };
  const addTag = () => { const v = tagInput.trim().replace(/^#/, ""); if (v && !(n.tags || []).includes(v)) setN({ ...n, tags: [...(n.tags || []), v] }); setTagInput(""); };
  const removeTag = (t) => setN({ ...n, tags: (n.tags || []).filter((x) => x !== t) });

  return (
    <div className="overlay">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h"><h3>{isEdit ? "Upravit poznámku" : "Nová poznámka"}</h3><button className="x" onClick={onCancel}><X size={18} /></button></div>
        <div className="sheet-b">
          <Field label="Složka">
            <div className="fwrow">
              <select value={n.folderId} onChange={pickFolder}>
                <option value="">— bez složky —</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              {folder && folder.template && <button type="button" className="btn ghost sm" onClick={() => setN({ ...n, body: folder.template })}>Šablona</button>}
            </div>
          </Field>
          <Field label="Název"><input value={n.title} onChange={(e) => setN({ ...n, title: e.target.value })} placeholder="Týden 24, Lekce z FOMO obchodu…" autoFocus /></Field>
          <Field label="Text"><textarea rows={12} value={n.body} onChange={(e) => setN({ ...n, body: e.target.value })} placeholder="Piš sem cokoli — plán, recap, postřeh…" /></Field>
          <Field label="Tagy">
            <div className="tag-input">
              {(n.tags || []).map((t) => <span className="chip" key={t}>#{t}<button type="button" onClick={() => removeTag(t)}><X size={11} /></button></span>)}
              <input value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }} placeholder="přidat tag + Enter" />
            </div>
          </Field>
        </div>
        <div className="sheet-f"><button className="btn ghost" onClick={onCancel}>Zrušit</button><button className="btn primary" onClick={() => onSave(n)}>Uložit</button></div>
      </div>
    </div>
  );
}

function FolderForm({ initial, onSave, onCancel, onDelete }) {
  const [f, setF] = useState(initial);
  const valid = f.name.trim().length > 0;
  return (
    <div className="overlay">
      <div className="sheet narrow" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h"><h3>{initial.name ? "Upravit složku" : "Nová složka"}</h3><button className="x" onClick={onCancel}><X size={18} /></button></div>
        <div className="sheet-b">
          <Field label="Název *"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sessions Recap, Lekce…" autoFocus /></Field>
          <Field label="Šablona" hint="předvyplní se u nové poznámky">
            <textarea rows={6} value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} placeholder="Struktura, která se objeví u každé nové poznámky v této složce…" /></Field>
          <Field label="Barva"><div className="swatches">{FW_COLORS.map((c) => <button key={c} type="button" className={`sw ${f.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setF({ ...f, color: c })} />)}</div></Field>
        </div>
        <div className="sheet-f">
          {initial.name && onDelete && <button className="btn ghost danger" onClick={() => onDelete(f.id)}><Trash2 size={14} /> Smazat</button>}
          <button className="btn ghost" onClick={onCancel}>Zrušit</button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave(f)}>Uložit</button>
        </div>
      </div>
    </div>
  );
}

/* ========================= REPORTS ========================= */
const WD_SHORT = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const WD_FULL = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"];
const weekdayIdx = (iso) => { const d = new Date(iso); return isNaN(d) ? 0 : (d.getDay() + 6) % 7; };
const hourOf = (iso) => { const d = new Date(iso); return isNaN(d) ? 0 : d.getHours(); };

const RANGES = [{ id: "all", label: "Vše" }, { id: "30", label: "30 dní" }, { id: "90", label: "90 dní" }, { id: "ytd", label: "Letos" }];

function ReportsView({ trades, frameworks, fwById, cur }) {
  const [range, setRange] = useState("all");

  const ft = useMemo(() => {
    if (range === "all") return trades;
    const now = new Date(); let cutoff;
    if (range === "ytd") cutoff = new Date(now.getFullYear(), 0, 1);
    else { cutoff = new Date(now); cutoff.setDate(now.getDate() - parseInt(range, 10)); }
    return trades.filter((t) => { const d = new Date(t.date); return !isNaN(d) && d >= cutoff; });
  }, [trades, range]);

  const byWeekday = useMemo(() => WD_SHORT.map((label, i) => {
    const ts = ft.filter((t) => weekdayIdx(t.date) === i); const s = computeStats(ts);
    return { label, full: WD_FULL[i], net: s.net, n: s.n, winRate: s.winRate };
  }), [ft]);

  const byHour = useMemo(() => Array.from({ length: 24 }, (_, h) => {
    const ts = ft.filter((t) => hourOf(t.date) === h); const s = computeStats(ts);
    return { label: `${h}:00`, h, net: s.net, n: s.n };
  }).filter((x) => x.n > 0), [ft]);

  const byFw = useMemo(() => {
    const rows = frameworks.map((f) => { const s = computeStats(ft.filter((t) => t.frameworkId === f.id)); return { label: f.name, color: f.color, net: s.net, n: s.n, winRate: s.winRate }; });
    const un = ft.filter((t) => !t.frameworkId); if (un.length) { const s = computeStats(un); rows.push({ label: "Bez playbooku", color: "#C8CCD8", net: s.net, n: s.n, winRate: s.winRate }); }
    return rows.filter((r) => r.n > 0).sort((a, b) => b.net - a.net);
  }, [frameworks, ft]);

  const bySymbol = useMemo(() => {
    const map = {};
    ft.forEach((t) => { const k = (t.symbol || "—").toUpperCase(); (map[k] = map[k] || []).push(t); });
    return Object.entries(map).map(([label, ts]) => { const s = computeStats(ts); return { label, net: s.net, n: s.n, winRate: s.winRate }; }).sort((a, b) => b.net - a.net);
  }, [ft]);

  const byTag = useMemo(() => {
    const map = {};
    ft.forEach((t) => (t.tags || []).forEach((tag) => { (map[tag] = map[tag] || []).push(t); }));
    return Object.entries(map).map(([label, ts]) => { const s = computeStats(ts); return { label, net: s.net, n: s.n, winRate: s.winRate }; }).sort((a, b) => b.net - a.net);
  }, [ft]);

  const byMistakes = useMemo(() => {
    const map = {};
    ft.forEach((t) => (t.mistakes || []).forEach((m) => { (map[m] = map[m] || []).push(t); }));
    return Object.entries(map).map(([label, ts]) => { const s = computeStats(ts); return { label, net: s.net, n: s.n, winRate: s.winRate }; }).sort((a, b) => a.net - b.net);
  }, [ft]);

  const longShort = useMemo(() => ({
    long: computeStats(ft.filter((t) => t.direction === "long")),
    short: computeStats(ft.filter((t) => t.direction === "short")),
  }), [ft]);

  const rDist = useMemo(() => {
    const rs = ft.map(computeR).filter((r) => r !== null);
    const buckets = [
      { label: "≤ −2R", neg: true, test: (r) => r <= -2 },
      { label: "−2…−1", neg: true, test: (r) => r > -2 && r <= -1 },
      { label: "−1…0", neg: true, test: (r) => r > -1 && r < 0 },
      { label: "0…1", neg: false, test: (r) => r >= 0 && r < 1 },
      { label: "1…2", neg: false, test: (r) => r >= 1 && r < 2 },
      { label: "≥ 2R", neg: false, test: (r) => r >= 2 },
    ];
    return { rows: buckets.map((b) => ({ label: b.label, neg: b.neg, count: rs.filter(b.test).length })), total: rs.length };
  }, [ft]);

  const insights = useMemo(() => {
    const out = [];
    const wd = byWeekday.filter((d) => d.n > 0);
    if (wd.length) {
      const best = wd.reduce((a, b) => (b.net > a.net ? b : a));
      const worst = wd.reduce((a, b) => (b.net < a.net ? b : a));
      out.push({ good: true, text: `Nejlepší den: ${best.full} (${fmtMoney(best.net, cur)})` });
      if (worst.net < 0 && worst !== best) out.push({ good: false, text: `Nejslabší den: ${worst.full} (${fmtMoney(worst.net, cur)})` });
    }
    if (byHour.length) { const b = byHour.reduce((a, b) => (b.net > a.net ? b : a)); if (b.net > 0) out.push({ good: true, text: `Nejlepší denní doba: ${b.label} (${fmtMoney(b.net, cur)})` }); }
    if (byFw.length) {
      const b = byFw[0]; if (b.net > 0) out.push({ good: true, text: `Nejziskovější playbook: ${b.label} (${fmtMoney(b.net, cur)}, ${fmtNum(b.winRate, 0)} % win)` });
      const w = byFw[byFw.length - 1]; if (w.net < 0 && w !== b) out.push({ good: false, text: `Ztrátový playbook: ${w.label} (${fmtMoney(w.net, cur)})` });
    }
    if (bySymbol.length && bySymbol[0].net > 0) out.push({ good: true, text: `Nejlepší symbol: ${bySymbol[0].label} (${fmtMoney(bySymbol[0].net, cur)})` });
    if (byTag.length && byTag[0].net > 0) out.push({ good: true, text: `Nejlepší tag: #${byTag[0].label} (${fmtMoney(byTag[0].net, cur)})` });
    if (byMistakes.length && byMistakes[0].net < 0) out.push({ good: false, text: `Nejdražší chyba: ${byMistakes[0].label} (${fmtMoney(byMistakes[0].net, cur)})` });
    if (longShort.long.n > 0 && longShort.short.n > 0) {
      const better = longShort.long.net >= longShort.short.net ? "Long" : "Short";
      out.push({ good: true, text: `Lépe ti jdou ${better} obchody` });
    }
    return out;
  }, [byWeekday, byHour, byFw, bySymbol, byTag, byMistakes, longShort, cur]);

  if (trades.length === 0) return <div className="empty">Žádná data pro reporty.</div>;

  return (
    <div className="stack reports">
      <div className="rep-filter">
        <div className="seg">
          {RANGES.map((r) => <button key={r.id} className={`seg-btn ${range === r.id ? "on" : ""}`} onClick={() => setRange(r.id)}>{r.label}</button>)}
        </div>
        <span className="rep-count">{ft.length} {pluralObchod(ft.length)}</span>
      </div>

      <div className="card insights">
        <div className="card-h">Souhrn · silné a slabé stránky</div>
        <div className="ins-list">
          {insights.length === 0 ? <div className="ins-empty">Přidej víc obchodů (a tagů/chyb), ať se objeví vzorce.</div>
            : insights.map((i, idx) => (
              <div className={`ins-item ${i.good ? "good" : "bad"}`} key={idx}>
                <span className="ins-dot" />{i.text}
              </div>
            ))}
        </div>
      </div>

      <div className="reports-grid">
        <NetBarReport title="Den v týdnu" data={byWeekday.filter((d) => d.n > 0)} cur={cur} />
        <NetBarReport title="Denní doba" data={byHour} cur={cur} />
        <NetBarReport title="Playbooky" data={byFw} cur={cur} />
        <RDistReport data={rDist} />
      </div>

      <div className="card report-card">
        <div className="report-h">Symboly</div>
        <SymbolList data={bySymbol} cur={cur} />
      </div>

      {(byTag.length > 0 || byMistakes.length > 0) && (
        <div className="reports-grid">
          {byTag.length > 0 && (
            <div className="card report-card">
              <div className="report-h">Tagy</div>
              <SymbolList data={byTag} cur={cur} prefix="#" />
            </div>
          )}
          {byMistakes.length > 0 && (
            <div className="card report-card">
              <div className="report-h">Chyby <span className="muted">· co tě stojí peníze</span></div>
              <SymbolList data={byMistakes} cur={cur} />
            </div>
          )}
        </div>
      )}

      <div className="card report-card">
        <div className="report-h">Long vs Short</div>
        <div className="lsplit">
          <LSBlock label="Long" s={longShort.long} cur={cur} tone="pos" />
          <LSBlock label="Short" s={longShort.short} cur={cur} tone="neg" />
        </div>
      </div>
    </div>
  );
}

function ReportTip({ active, payload, cur }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return <div className="tip"><div className="tip-l">{d.full || d.label}{d.n != null ? ` · ${d.n} ${pluralObchod(d.n)}` : ""}</div>
    <div className={`tip-v ${d.net >= 0 ? "pos" : "neg"}`}>{fmtMoney(d.net, cur)}</div></div>;
}

function NetBarReport({ title, data, cur }) {
  return (
    <div className="card report-card">
      <div className="report-h">{title}</div>
      {data.length === 0 ? <div className="report-empty">Zatím bez dat.</div> : (
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -8 }}>
            <XAxis dataKey="label" tick={{ fill: "#8A90A2", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={data.length > 8 ? -35 : 0} textAnchor={data.length > 8 ? "end" : "middle"} height={data.length > 8 ? 46 : 24} />
            <YAxis tick={{ fill: "#8A90A2", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtCompact(v, cur).replace("+", "")} width={48} />
            <ReferenceLine y={0} stroke="#E8EAF1" />
            <Tooltip cursor={{ fill: "rgba(23,56,111,.06)" }} content={<ReportTip cur={cur} />} />
            <Bar dataKey="net" radius={[5, 5, 0, 0]} maxBarSize={46}>
              {data.map((d, i) => <Cell key={i} fill={d.net >= 0 ? "#16C784" : "#F0454E"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function RDistReport({ data }) {
  const max = Math.max(...data.rows.map((r) => r.count), 1);
  return (
    <div className="card report-card">
      <div className="report-h">Rozdělení R-multiple <span className="muted">· {data.total} s R</span></div>
      {data.total === 0 ? <div className="report-empty">Vyplň stop loss u obchodů, ať se počítá R.</div> : (
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={data.rows} margin={{ top: 8, right: 6, bottom: 0, left: -20 }}>
            <XAxis dataKey="label" tick={{ fill: "#8A90A2", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
            <YAxis tick={{ fill: "#8A90A2", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
            <Tooltip cursor={{ fill: "rgba(23,56,111,.06)" }} content={({ active, payload }) => active && payload?.length
              ? <div className="tip"><div className="tip-l">{payload[0].payload.label}</div><div className="tip-v">{payload[0].payload.count} {pluralObchod(payload[0].payload.count)}</div></div> : null} />
            <Bar dataKey="count" radius={[5, 5, 0, 0]} maxBarSize={48}>
              {data.rows.map((r, i) => <Cell key={i} fill={r.neg ? "#F0454E" : "#16C784"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function SymbolList({ data, cur, prefix = "" }) {
  if (data.length === 0) return <div className="report-empty">Zatím bez dat.</div>;
  const max = Math.max(...data.map((d) => Math.abs(d.net)), 1);
  return (
    <div className="sym-list">
      {data.map((d) => (
        <div className="sym-row" key={d.label}>
          <span className="sym-name">{prefix}{d.label}</span>
          <div className="sym-track">
            <div className={`sym-bar ${d.net >= 0 ? "pos" : "neg"}`} style={{ width: `${(Math.abs(d.net) / max) * 100}%` }} />
          </div>
          <span className="sym-meta">{d.n} obch · {fmtNum(d.winRate, 0)} %</span>
          <span className={`sym-net ${d.net >= 0 ? "pos" : "neg"}`}>{fmtMoney(d.net, cur)}</span>
        </div>
      ))}
    </div>
  );
}

function LSBlock({ label, s, cur, tone }) {
  return (
    <div className="ls-block">
      <div className="ls-head"><span className={`dir ${tone === "pos" ? "long" : "short"}`}>{label.toUpperCase()}</span></div>
      <div className={`ls-net ${s.net >= 0 ? "pos" : "neg"}`}>{fmtMoney(s.net, cur)}</div>
      <div className="ls-stats">
        <div><span>Obchody</span><b>{s.n}</b></div>
        <div><span>Win rate</span><b>{s.n ? `${fmtNum(s.winRate, 0)} %` : "—"}</b></div>
        <div><span>Profit factor</span><b>{s.n ? (s.profitFactor === Infinity ? "∞" : fmtNum(s.profitFactor)) : "—"}</b></div>
      </div>
    </div>
  );
}

/* ========================= PROGRESS TRACKER ========================= */
function ProgressView({ progress, trades, onToggle, onEditRules }) {
  const { rules, log } = progress;
  const active = rules.filter((r) => r.active !== false);
  const tradesByDay = useMemo(() => { const m = {}; trades.forEach((t) => { const k = dayKey(t.date); if (k) (m[k] = m[k] || []).push(t); }); return m; }, [trades]);
  const todayKey = localKey(new Date());
  const [sel, setSel] = useState(todayKey);
  const weeks = useMemo(() => buildHeatWeeks(12), []);

  const scoreOf = (key) => {
    if (!active.length) return { followed: 0, total: 0, pct: 0 };
    const dts = tradesByDay[key] || [];
    let f = 0;
    active.forEach((r) => { const ok = r.type === "auto" ? evalAutoRule(r, dts) : !!(log[key] && log[key][r.id]); if (ok) f++; });
    return { followed: f, total: active.length, pct: (f / active.length) * 100 };
  };
  const selScore = scoreOf(sel);
  const isToday = sel === todayKey;
  const selDate = new Date(sel + "T00:00:00");
  const selLabel = selDate.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
  const shiftDay = (d) => { const dt = new Date(sel + "T00:00:00"); dt.setDate(dt.getDate() + d); if (localKey(dt) > todayKey) return; setSel(localKey(dt)); };

  return (
    <div className="stack pg">
      <div className="fw-top">
        <p className="fw-intro">Buduj disciplínu: odškrtávej pravidla každý den. Některá se vyhodnotí sama z obchodů (playbook, max ztráta), ostatní si odškrtneš ručně.</p>
        <button className="btn ghost" onClick={onEditRules}><Pencil size={14} /> Upravit pravidla</button>
      </div>

      <div className="pg-grid">
        <div className="card pg-score">
          <div className="pg-daynav">
            <button onClick={() => shiftDay(-1)}><ChevronLeft size={16} /></button>
            <span>{isToday ? "Dnes" : selLabel}</span>
            <button onClick={() => shiftDay(1)} disabled={isToday}><ChevronRight size={16} /></button>
          </div>
          <Gauge value={Math.round(selScore.pct)} color={pctColor(selScore.pct)} />
          <div className="pg-score-sub">{selScore.followed}/{selScore.total} pravidel splněno</div>
        </div>

        <div className="card pg-rules">
          <div className="card-h">Pravidla — {isToday ? "dnes" : selLabel}</div>
          <div className="pg-rule-list">
            {active.length === 0 ? <div className="report-empty">Žádná aktivní pravidla. Přidej je přes „Upravit pravidla".</div>
              : active.map((r) => {
                const dts = tradesByDay[sel] || [];
                const auto = r.type === "auto";
                const ok = auto ? evalAutoRule(r, dts) : !!(log[sel] && log[sel][r.id]);
                return (
                  <button key={r.id} className={`pg-rule ${ok ? "on" : ""} ${auto ? "is-auto" : ""}`} disabled={auto} onClick={() => !auto && onToggle(sel, r.id)}>
                    <span className="rbox">{ok && <Check size={12} />}</span>
                    <span className="pg-rule-name">{r.name}</span>
                    {auto && <span className="auto-tag">auto</span>}
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      <div className="card pg-heat">
        <div className="card-h">Konzistence · posledních 12 týdnů</div>
        <div className="heat">
          {weeks.map((col, ci) => (
            <div className="heat-col" key={ci}>
              {col.map((cell, di) => {
                if (cell.future) return <div className="heat-cell future" key={di} />;
                const sc = scoreOf(cell.key);
                const lvl = sc.total ? bandLevel(sc.pct) : 0;
                return <button key={di} className={`heat-cell lvl${lvl} ${cell.key === sel ? "sel" : ""}`}
                  title={`${cell.key} · ${sc.followed}/${sc.total}`} onClick={() => setSel(cell.key)} />;
              })}
            </div>
          ))}
        </div>
        <div className="heat-legend"><span>méně</span><i className="lvl0" /><i className="lvl1" /><i className="lvl2" /><i className="lvl3" /><i className="lvl4" /><span>více</span></div>
      </div>
    </div>
  );
}

function RulesForm({ initial, onSave, onCancel }) {
  const [rules, setRules] = useState(initial.map((r) => ({ ...r })));
  const upd = (i, patch) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRules((rs) => [...rs, { id: uid(), name: "", type: "manual", active: true }]);
  const del = (i) => setRules((rs) => rs.filter((_, j) => j !== i));
  const save = () => onSave(rules.filter((r) => r.name.trim()).map((r) => ({ ...r, name: r.name.trim() })));
  return (
    <div className="overlay">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h"><h3>Pravidla disciplíny</h3><button className="x" onClick={onCancel}><X size={18} /></button></div>
        <div className="sheet-b">
          <p className="hint-line">Manuální pravidla si odškrtáváš sám. Automatická se vyhodnotí z obchodů (playbook, max denní ztráta). Vypnutím checkboxu pravidlo deaktivuješ.</p>
          {rules.map((r, i) => (
            <div className="rule-edit" key={r.id}>
              <label className="mini-tgl">
                <input type="checkbox" checked={r.active !== false} onChange={(e) => upd(i, { active: e.target.checked })} />
                <span className="tgl-box">{r.active !== false && <Check size={11} />}</span>
              </label>
              <input className="rule-name-in" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Název pravidla" />
              {r.type === "auto"
                ? (r.kind === "maxLoss"
                  ? <input className="rule-val" type="number" value={r.value} onChange={(e) => upd(i, { value: e.target.value })} title="Max denní ztráta" />
                  : <span className="auto-tag">auto</span>)
                : <span className="manual-tag">manuál</span>}
              <button className="rule-del" onClick={() => del(i)}><Trash2 size={14} /></button>
            </div>
          ))}
          <button className="btn ghost sm add-rule" onClick={add}><Plus size={14} /> Přidat pravidlo</button>
        </div>
        <div className="sheet-f"><button className="btn ghost" onClick={onCancel}>Zrušit</button><button className="btn primary" onClick={save}>Uložit</button></div>
      </div>
    </div>
  );
}

/* ========================= CALENDAR ========================= */
function CalendarView({ trades, cur }) {
  const [ref, setRef] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const byDay = useMemo(() => {
    const map = {};
    trades.forEach((t) => { const k = dayKey(t.date); if (!k) return; (map[k] = map[k] || { pnl: 0, n: 0 }); map[k].pnl += computePnl(t); map[k].n++; });
    return map;
  }, [trades]);

  const first = new Date(ref.y, ref.m, 1);
  const startOffset = (first.getDay() + 6) % 7; // pondělí = 0
  const daysInMonth = new Date(ref.y, ref.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthTotal = Object.entries(byDay).filter(([k]) => k.startsWith(`${ref.y}-${String(ref.m + 1).padStart(2, "0")}`))
    .reduce((a, [, v]) => a + v.pnl, 0);

  const move = (delta) => setRef((r) => { const d = new Date(r.y, r.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const monthName = first.toLocaleString("cs-CZ", { month: "long", year: "numeric" });

  return (
    <div className="card cal-card">
      <div className="cal-head">
        <div className="cal-nav">
          <button onClick={() => move(-1)}><ChevronLeft size={18} /></button>
          <span className="cal-title">{monthName}</span>
          <button onClick={() => move(1)}><ChevronRight size={18} /></button>
        </div>
        <div className={`cal-total ${monthTotal >= 0 ? "pos" : "neg"}`}>{fmtMoney(monthTotal, cur)}</div>
      </div>
      <div className="cal-grid head">{["Po", "Út", "St", "Čt", "Pá", "So", "Ne"].map((d) => <div key={d} className="cal-dow">{d}</div>)}</div>
      {weeks.map((w, wi) => {
        const wTotal = w.reduce((a, d) => a + (d && byDay[cellKey(ref, d)] ? byDay[cellKey(ref, d)].pnl : 0), 0);
        const wTrades = w.reduce((a, d) => a + (d && byDay[cellKey(ref, d)] ? byDay[cellKey(ref, d)].n : 0), 0);
        return (
          <div className="cal-grid" key={wi}>
            {w.map((d, di) => {
              if (!d) return <div className="cal-cell empty-cell" key={di} />;
              const data = byDay[cellKey(ref, d)];
              const tone = data ? (data.pnl > 0 ? "pos" : data.pnl < 0 ? "neg" : "flat") : "";
              return (
                <div className={`cal-cell ${tone}`} key={di}>
                  <span className="cal-d">{d}</span>
                  {data && <><span className="cal-pnl">{fmtCompact(data.pnl, cur)}</span><span className="cal-n">{data.n} {pluralObchod(data.n)}</span></>}
                </div>
              );
            })}
            <div className={`cal-cell week ${wTotal >= 0 ? "pos" : "neg"}`}>
              <span className="cal-wl">Týden</span>
              {wTrades > 0 ? <><span className="cal-pnl">{fmtCompact(wTotal, cur)}</span><span className="cal-n">{wTrades} {pluralObchod(wTrades)}</span></> : <span className="cal-n">—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function cellKey(ref, d) { return `${ref.y}-${String(ref.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

/* ========================= FRAMEWORKS ========================= */
function FrameworksView({ frameworks, trades, cur, onNew, onEdit, onDelete }) {
  const rows = useMemo(() => frameworks.map((f) => {
    const all = trades.filter((t) => t.frameworkId === f.id);
    const real = all.filter((t) => !t.missed);
    const missed = all.length - real.length;
    const rulesN = (f.rules || []).length;
    let adherence = null;
    if (rulesN > 0 && real.length) {
      adherence = real.reduce((a, t) => a + Math.min((t.ruleChecks || []).length, rulesN) / rulesN, 0) / real.length * 100;
    }
    return { f, s: computeStats(real), missed, rulesN, adherence };
  }).sort((a, b) => b.s.net - a.s.net), [frameworks, trades]);
  const unassigned = trades.filter((t) => !t.frameworkId && !t.missed);

  return (
    <div className="stack">
      <div className="fw-top">
        <p className="fw-intro">Playbooky jsou tvoje strategie s pravidly. Přiřaď je obchodům, odškrtávej splněná pravidla a uvidíš, který playbook vydělává a jak ho dodržuješ.</p>
        <button className="btn primary" onClick={onNew}><Plus size={16} /> Nový playbook</button>
      </div>

      {frameworks.length === 0 ? (
        <div className="card empty-card center">
          <Layers size={26} />
          <h2>Zatím žádné playbooky</h2>
          <p>Vytvoř svůj první playbook (např. „Breakout", „ICT", „Pullback"), přidej pravidla a začni k němu přiřazovat obchody.</p>
          <button className="btn primary" onClick={onNew}><Plus size={16} /> Vytvořit playbook</button>
        </div>
      ) : (
        <div className="fw-grid">
          {rows.map(({ f, s, missed, rulesN, adherence }) => (
            <div className="card fw-card" key={f.id}>
              <div className="fw-card-h">
                <div className="fw-name"><i className="fdot lg" style={{ background: f.color }} />{f.name}</div>
                <div className="fw-acts">
                  <button onClick={() => onEdit(f)}><Pencil size={14} /></button>
                  <button onClick={() => onDelete(f.id)}><Trash2 size={14} /></button>
                </div>
              </div>
              {f.description && <p className="fw-desc">{f.description}</p>}
              <div className="fw-meta">
                {rulesN > 0 && <span className="fw-pill">{rulesN} {rulesN === 1 ? "pravidlo" : rulesN <= 4 ? "pravidla" : "pravidel"}</span>}
                {missed > 0 && <span className="fw-pill miss">{missed} zmeškaných</span>}
              </div>
              <div className="fw-stats">
                <div><span>Net P&L</span><b className={s.net >= 0 ? "pos" : "neg"}>{fmtMoney(s.net, cur)}</b></div>
                <div><span>Obchody</span><b>{s.n}</b></div>
                <div><span>Win rate</span><b>{s.n ? `${fmtNum(s.winRate, 0)} %` : "—"}</b></div>
                <div><span>Profit factor</span><b>{s.n ? (s.profitFactor === Infinity ? "∞" : fmtNum(s.profitFactor)) : "—"}</b></div>
              </div>
              {adherence !== null && s.n > 0 && (
                <div className="fw-adh">
                  <div className="fw-adh-h"><span>Dodržení pravidel</span><b>{fmtNum(adherence, 0)} %</b></div>
                  <div className="fw-bar"><div className="fw-bar-fill" style={{ width: `${clamp(adherence, 0, 100)}%`, background: f.color }} /></div>
                </div>
              )}
            </div>
          ))}
          {unassigned.length > 0 && (
            <div className="card fw-card muted-card">
              <div className="fw-card-h"><div className="fw-name"><i className="fdot lg" style={{ background: "#C8CCD8" }} />Bez playbooku</div></div>
              <div className="fw-stats">
                <div><span>Net P&L</span><b className={computeStats(unassigned).net >= 0 ? "pos" : "neg"}>{fmtMoney(computeStats(unassigned).net, cur)}</b></div>
                <div><span>Obchody</span><b>{unassigned.length}</b></div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ========================= FORMS ========================= */
function ChipInput({ values, onChange, placeholder, tone }) {
  const [v, setV] = useState("");
  const add = () => { const x = v.trim().replace(/^#/, ""); if (x && !values.includes(x)) onChange([...values, x]); setV(""); };
  return (
    <div className={`tag-input ${tone === "bad" ? "bad" : ""}`}>
      {values.map((t) => (
        <span className={`chip ${tone === "bad" ? "bad" : ""}`} key={t}>{tone === "bad" ? "" : "#"}{t}
          <button type="button" onClick={() => onChange(values.filter((y) => y !== t))}><X size={11} /></button></span>
      ))}
      <input value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} placeholder={placeholder} />
    </div>
  );
}

function ShotInput({ shots, onChange, large = false }) {
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const onPick = async (e) => {
    const files = [...e.target.files]; e.target.value = "";
    if (!files.length) return; setBusy(true);
    const thumbs = [];
    for (const f of files) { try { thumbs.push(await fileToThumb(f)); } catch {} }
    setBusy(false); onChange([...shots, ...thumbs]);
  };
  return (
    <>
      <div className={`shots ${large ? "large" : ""}`}>
        {shots.map((s, i) => (
          <div className="shot" key={i}>
            <img src={s} alt="" onClick={() => setView(s)} />
            <button type="button" className="shot-del" onClick={() => onChange(shots.filter((_, j) => j !== i))}><X size={12} /></button>
          </div>
        ))}
        <label className="shot-add">
          <ImageIcon size={18} /><span>{busy ? "Zpracovávám…" : "Přidat screen"}</span>
          <input type="file" accept="image/*" multiple onChange={onPick} hidden />
        </label>
      </div>
      {view && <div className="lightbox" onClick={() => setView(null)}><img src={view} alt="" /><button className="lb-x" onClick={() => setView(null)}><X size={20} /></button></div>}
    </>
  );
}

function AccountsForm({ initial, hasTradesFor, onSave, onCancel }) {
  const [accounts, setAccounts] = useState(initial.map((a) => ({ ...a })));
  const upd = (i, patch) => setAccounts((as) => as.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const add = () => setAccounts((as) => [...as, { id: uid(), name: "", currency: "$" }]);
  const del = (i) => {
    const a = accounts[i];
    if (accounts.length <= 1) { window.alert("Musí zůstat aspoň jeden účet."); return; }
    if (hasTradesFor(a.id) && !window.confirm("Tento účet má obchody. Po smazání se přesunou na první zbylý účet. Pokračovat?")) return;
    setAccounts((as) => as.filter((_, j) => j !== i));
  };
  const valid = accounts.length > 0 && accounts.every((a) => a.name.trim());
  const save = () => onSave(accounts.map((a) => ({ ...a, name: a.name.trim(), currency: (a.currency || "$").slice(0, 3) })));
  return (
    <div className="overlay">
      <div className="sheet narrow" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h"><h3>Účty</h3><button className="x" onClick={onCancel}><X size={18} /></button></div>
        <div className="sheet-b">
          <p className="hint-line">Každý obchod patří k jednomu účtu a měna je per účet. Mezi účty přepínáš vlevo dole. Statistiky a reporty se počítají vždy za aktivní účet.</p>
          {accounts.map((a, i) => (
            <div className="acc-edit" key={a.id}>
              <input className="acc-name" value={a.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Název účtu" />
              <input className="acc-cur" value={a.currency} onChange={(e) => upd(i, { currency: e.target.value.slice(0, 3) })} placeholder="$" />
              <button className="rule-del" onClick={() => del(i)}><Trash2 size={14} /></button>
            </div>
          ))}
          <button className="btn ghost sm add-rule" onClick={add}><Plus size={14} /> Přidat účet</button>
        </div>
        <div className="sheet-f"><button className="btn ghost" onClick={onCancel}>Zrušit</button><button className="btn primary" disabled={!valid} onClick={save}>Uložit</button></div>
      </div>
    </div>
  );
}

function ImportForm({ onImport, onImportNinja, onCancel }) {
  const [cols, setCols] = useState(null);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [ninja, setNinja] = useState(false);

  const onFile = (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    setName(f.name); setErr("");
    Papa.parse(f, {
      header: true, skipEmptyLines: "greedy",
      complete: (res) => {
        const fields = (res.meta.fields || []).filter(Boolean);
        if (!fields.length || !res.data.length) { setErr("V souboru se nepodařilo najít sloupce ani řádky. Má první řádek hlavičku?"); return; }
        const isNT = isNinjaTrades(fields);
        setNinja(isNT); setCols(fields); setRows(res.data);
        if (!isNT) setMapping(guessMapping(fields));
      },
      error: () => setErr("Soubor se nepodařilo načíst."),
    });
  };
  const setMap = (field, col) => setMapping((m) => ({ ...m, [field]: col || undefined }));
  const ready = cols && rows.length > 0;
  const grouped = useMemo(() => (ninja ? groupNinjaTrades(rows) : []), [ninja, rows]);
  const preview = rows.slice(0, 4);

  return (
    <div className="overlay">
      <div className="sheet wide" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h"><h3>Import obchodů</h3><button className="x" onClick={onCancel}><X size={18} /></button></div>
        <div className="sheet-b">
          {!ready ? (
            <>
              <p className="hint-line">Nahraj <b>export ze záložky Trades z NinjaTraderu</b> (pozná se sám a seskupí scale-outy do jednoho obchodu), nebo libovolné CSV z jiného nástroje. Obchody se přidají do aktivního účtu.</p>
              <label className="csv-drop">
                <FileText size={26} />
                <span>{err || "Vyber CSV soubor"}</span>
                <input type="file" accept=".csv,text/csv" onChange={onFile} hidden />
              </label>
            </>
          ) : ninja ? (
            <>
              <div className="nt-badge">✓ Rozpoznán export z <b>NinjaTraderu</b> — sloupce se namapují automaticky.</div>
              <div className="csv-file"><FileText size={15} /> {name}
                <span className="muted">· {rows.length} řádků → <b>{grouped.length} {pluralObchod(grouped.length)}</b> po seskupení</span>
                <button className="btn ghost sm" onClick={() => { setCols(null); setRows([]); setNinja(false); }}>Jiný soubor</button></div>
              <div className="csv-prev">
                <div className="csv-prev-h">Náhled (po seskupení podle vstupu)</div>
                <table className="csv-table">
                  <thead><tr><th>Datum</th><th>Symbol</th><th>Směr</th><th className="r">Kontr.</th><th className="r">Vstup → Výstup</th><th className="r">P&L</th><th className="r">MAE / MFE</th></tr></thead>
                  <tbody>
                    {grouped.slice(0, 6).map((g, i) => (
                      <tr key={i}>
                        <td>{g.date ? toLocalInput(g.date).replace("T", " ") : "—"}</td>
                        <td><b>{g.symbol}</b></td>
                        <td>{g.direction === "short" ? "Short" : "Long"}</td>
                        <td className="r">{g.quantity}</td>
                        <td className="r">{g.entryPrice} → {g.exitPrice}</td>
                        <td className="r">{g.pnl} $</td>
                        <td className="r">{g.mae} / {g.mfe}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {grouped.length > 6 && <div className="csv-more">…a dalších {grouped.length - 6}</div>}
              </div>
              <p className="hint-line" style={{ marginTop: 12 }}>P&L, risk a R se po importu počítají přes tick value instrumentů. Stop loss v exportu není, takže R u importovaných obchodů doplníš ručně, když budeš chtít.</p>
            </>
          ) : (
            <>
              <div className="csv-file"><FileText size={15} /> {name} <span className="muted">· {rows.length} řádků</span>
                <button className="btn ghost sm" onClick={() => { setCols(null); setRows([]); }}>Jiný soubor</button></div>
              <div className="map-grid">
                {IMPORT_FIELDS.map((f) => (
                  <div className="map-row" key={f.key}>
                    <span className="map-l">{f.label}</span>
                    <select value={mapping[f.key] || ""} onChange={(e) => setMap(f.key, e.target.value)}>
                      <option value="">— ignorovat —</option>
                      {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="csv-prev">
                <div className="csv-prev-h">Náhled (první 4 řádky)</div>
                <table className="csv-table">
                  <thead><tr><th>Datum</th><th>Symbol</th><th>Směr</th><th>P&L / ceny</th><th>Playbook</th></tr></thead>
                  <tbody>
                    {preview.map((r, i) => {
                      const g = (k) => (mapping[k] ? r[mapping[k]] : "");
                      return <tr key={i}>
                        <td>{String(g("date") || "—").slice(0, 16)}</td>
                        <td>{g("symbol") || "—"}</td>
                        <td>{g("direction") || "—"}</td>
                        <td>{g("pnl") || `${g("entryPrice") || "?"}→${g("exitPrice") || "?"}`}</td>
                        <td>{g("playbook") || "—"}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="sheet-f">
          <button className="btn ghost" onClick={onCancel}>Zrušit</button>
          {ready && ninja && <button className="btn primary" onClick={() => onImportNinja(rows)}>Importovat {grouped.length} {pluralObchod(grouped.length)}</button>}
          {ready && !ninja && <button className="btn primary" onClick={() => onImport(rows, mapping)}>Importovat {rows.length} {pluralObchod(rows.length)}</button>}
        </div>
      </div>
    </div>
  );
}

function TradeForm({ initial, onSave, onCancel, cur, frameworks, onCreateFramework, onShowChart }) {
  const [t, setT] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [newFw, setNewFw] = useState("");
  const set = (k) => (e) => setT({ ...t, [k]: e.target.value });
  const pnl = computePnl(t), r = computeR(t);
  const valid = t.symbol.trim().length > 0;
  const autoP = isFinite(num(t.entryPrice)) && isFinite(num(t.exitPrice)) && isFinite(num(t.quantity));
  const selFw = frameworks.find((f) => f.id === t.frameworkId);
  const rules = selFw?.rules || [];
  const checks = t.ruleChecks || [];

  const addFw = () => { if (!newFw.trim()) return; const id = onCreateFramework(newFw.trim()); setT({ ...t, frameworkId: id }); setNewFw(""); setAdding(false); };
  const toggleRule = (rule) => setT({ ...t, ruleChecks: checks.includes(rule) ? checks.filter((x) => x !== rule) : [...checks, rule] });

  return (
    <div className="overlay">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <h3>{initial.symbol ? "Upravit obchod" : "Nový obchod"}</h3>
          <div className="sheet-h-act">
            {onShowChart && t.symbol.trim() && (
              <button className="btn ghost sm" onClick={() => onShowChart(t)}><BarChart3 size={14} /> Graf</button>
            )}
            <button className="x" onClick={onCancel}><X size={18} /></button>
          </div>
        </div>
        <div className="sheet-b">
          <div className="dirtog">
            <button className={t.direction === "long" ? "on long" : ""} onClick={() => setT({ ...t, direction: "long" })}><TrendingUp size={15} /> Long</button>
            <button className={t.direction === "short" ? "on short" : ""} onClick={() => setT({ ...t, direction: "short" })}><TrendingDown size={15} /> Short</button>
          </div>
          <div className="g2">
            <Field label="Symbol *"><input value={t.symbol} onChange={set("symbol")} placeholder="EURUSD, AAPL, BTC…" autoFocus /></Field>
            <Field label="Datum a čas"><input type="datetime-local" value={t.date} onChange={set("date")} /></Field>
          </div>

          <Field label="Playbook / strategie">
            {!adding ? (
              <div className="fwrow">
                <select value={t.frameworkId} onChange={set("frameworkId")}>
                  <option value="">— bez playbooku —</option>
                  {frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button type="button" className="btn ghost sm" onClick={() => setAdding(true)}><Plus size={14} /> Nový</button>
              </div>
            ) : (
              <div className="fwrow">
                <input value={newFw} onChange={(e) => setNewFw(e.target.value)} placeholder="Název playbooku"
                  onKeyDown={(e) => e.key === "Enter" && addFw()} autoFocus />
                <button type="button" className="btn primary sm" onClick={addFw}>Přidat</button>
                <button type="button" className="btn ghost sm" onClick={() => { setAdding(false); setNewFw(""); }}><X size={14} /></button>
              </div>
            )}
          </Field>

          {rules.length > 0 && (
            <Field label="Pravidla playbooku" hint={`splněno ${checks.filter((c) => rules.includes(c)).length}/${rules.length}`}>
              <div className="rulecheck">
                {rules.map((rule, i) => {
                  const on = checks.includes(rule);
                  return (
                    <button type="button" key={i} className={`rcheck ${on ? "on" : ""}`} onClick={() => toggleRule(rule)}>
                      <span className="rbox">{on && <Check size={12} />}</span>{rule}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          <div className="g3">
            <Field label="Vstupní cena"><input type="number" step="any" value={t.entryPrice} onChange={set("entryPrice")} /></Field>
            <Field label="Výstupní cena"><input type="number" step="any" value={t.exitPrice} onChange={set("exitPrice")} /></Field>
            <Field label="Velikost"><input type="number" step="any" value={t.quantity} onChange={set("quantity")} /></Field>
          </div>
          <div className="g3">
            <Field label="Stop loss" hint="pro R"><input type="number" step="any" value={t.stopLoss} onChange={set("stopLoss")} /></Field>
            <Field label="Poplatky"><input type="number" step="any" value={t.fees} onChange={set("fees")} /></Field>
            <Field label={`P&L ručně`} hint="bez cen"><input type="number" step="any" value={t.pnl} onChange={set("pnl")} disabled={autoP} /></Field>
          </div>
          <div className="g2">
            <Field label="MAE" hint="max nepříznivý pohyb"><input type="number" step="any" value={t.mae} onChange={set("mae")} /></Field>
            <Field label="MFE" hint="max příznivý pohyb"><input type="number" step="any" value={t.mfe} onChange={set("mfe")} /></Field>
          </div>

          <Field label="Hodnocení exekuce">
            <div className="rating">
              {RATINGS.map((g) => <button key={g} type="button" className={`rb ${t.rating === g ? "on" : ""}`} onClick={() => setT({ ...t, rating: t.rating === g ? "" : g })}>{g}</button>)}
            </div>
          </Field>

          <div className="toggles">
            <label className={`tgl ${t.reviewed ? "on" : ""}`}>
              <input type="checkbox" checked={t.reviewed} onChange={(e) => setT({ ...t, reviewed: e.target.checked })} /><span className="tgl-box">{t.reviewed && <Check size={12} />}</span>Zkontrolováno
            </label>
            <label className={`tgl ${t.missed ? "on miss" : ""}`}>
              <input type="checkbox" checked={t.missed} onChange={(e) => setT({ ...t, missed: e.target.checked })} /><span className="tgl-box">{t.missed && <Check size={12} />}</span>Zmeškaný obchod
            </label>
          </div>
          {t.missed && <p className="hint-line">Zmeškaný obchod se počítá k playbooku, ale nevstupuje do P&L ani statistik.</p>}

          <Field label="Tagy" hint="setupy, podmínky, emoce"><ChipInput values={t.tags || []} onChange={(v) => setT({ ...t, tags: v })} placeholder="přidat tag + Enter" /></Field>
          <Field label="Chyby" hint="co se nepovedlo"><ChipInput values={t.mistakes || []} onChange={(v) => setT({ ...t, mistakes: v })} placeholder="přidat chybu + Enter" tone="bad" /></Field>
          <Field label="Screenshoty" hint="grafy k obchodu"><ShotInput shots={t.shots || []} onChange={(v) => setT({ ...t, shots: v })} /></Field>
          <Field label="Poznámky"><textarea rows={3} value={t.notes} onChange={set("notes")} placeholder="Co tě k obchodu vedlo, jak ses cítil, co příště jinak…" /></Field>

          <div className="live">
            <div><span className="live-l">Výsledný P&L</span><span className={`live-v ${pnl >= 0 ? "pos" : "neg"}`}>{fmtMoney(pnl, cur)}</span></div>
            <div><span className="live-l">R-multiple</span><span className={`live-v ${r === null ? "mut" : r >= 0 ? "pos" : "neg"}`}>{r === null ? "—" : `${r >= 0 ? "+" : ""}${fmtNum(r)}R`}</span></div>
          </div>
        </div>
        <div className="sheet-f"><button className="btn ghost" onClick={onCancel}>Zrušit</button><button className="btn primary" disabled={!valid} onClick={() => onSave(t)}>Uložit obchod</button></div>
      </div>
    </div>
  );
}

function FrameworkForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({ ...initial, rules: initial.rules || [] });
  const valid = f.name.trim().length > 0;
  const setRule = (i, v) => { const n = [...f.rules]; n[i] = v; setF({ ...f, rules: n }); };
  const save = () => onSave({ ...f, rules: f.rules.map((r) => r.trim()).filter(Boolean) });
  return (
    <div className="overlay">
      <div className="sheet narrow" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h"><h3>{initial.name ? "Upravit playbook" : "Nový playbook"}</h3><button className="x" onClick={onCancel}><X size={18} /></button></div>
        <div className="sheet-b">
          <Field label="Název *"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Breakout, ICT, Pullback…" autoFocus /></Field>
          <Field label="Popis" hint="kdy do obchodu vstupuješ a vystupuješ">
            <textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Vstup: … Výstup: … Podmínky: …" /></Field>
          <Field label="Pravidla" hint="checklist, který odškrtáváš u obchodu">
            <div className="rules-edit">
              {f.rules.map((r, i) => (
                <div className="rule-row" key={i}>
                  <input value={r} onChange={(e) => setRule(i, e.target.value)} placeholder={`Pravidlo ${i + 1}`} />
                  <button type="button" onClick={() => setF({ ...f, rules: f.rules.filter((_, j) => j !== i) })}><X size={14} /></button>
                </div>
              ))}
              <button type="button" className="btn ghost sm add-rule" onClick={() => setF({ ...f, rules: [...f.rules, ""] })}><Plus size={14} /> Přidat pravidlo</button>
            </div>
          </Field>
          <Field label="Barva">
            <div className="swatches">{FW_COLORS.map((c) => (
              <button key={c} type="button" className={`sw ${f.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => setF({ ...f, color: c })} />
            ))}</div>
          </Field>
        </div>
        <div className="sheet-f"><button className="btn ghost" onClick={onCancel}>Zrušit</button><button className="btn primary" disabled={!valid} onClick={save}>Uložit</button></div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return <label className="field"><span className="field-l">{label}{hint && <em> · {hint}</em>}</span>{children}</label>;
}
function EmptyState({ onAdd, onImport }) {
  return (
    <div className="empty-hero"><div className="card empty-card center">
      <BookOpen size={26} /><h2>Začni zapisovat obchody</h2>
      <p>Po prvním obchodu uvidíš Zella Score, win rate, profit factor, equity křivku a kalendář. Tady se začíná hledat tvůj edge.</p>
      <div className="empty-btns">
        <button className="btn primary" onClick={onAdd}><Plus size={16} /> Zapsat první obchod</button>
        <button className="btn ghost" onClick={onImport}><FileText size={16} /> Import z NinjaTraderu / CSV</button>
      </div>
    </div></div>
  );
}

function RedeemScreen({ onRedeem }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!code.trim()) { setErr("Zadej kód od mentora."); return; }
    setBusy(true); setErr("");
    const r = await onRedeem(code.trim());
    setBusy(false);
    if (r?.error) setErr(r.error);
  };
  return (
    <div className="mentor-lock">
      <div className="card lock-card center">
        <Lock size={26} />
        <h2>Mentoring je uzamčený</h2>
        <p>Tahle sekce je dostupná jen se zvacím kódem od tvého mentora. Jakmile ho dostaneš, zadej ho sem a odemkne se ti denní plán, dozorované obchody i zpětná vazba.</p>
        <div className="lock-row">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Např. AB3K-7XQ2" onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button className="btn primary" disabled={busy} onClick={submit}>{busy ? "Připojuji…" : "Připojit se"}</button>
        </div>
        {err && <div className="lock-err">{err}</div>}
      </div>
    </div>
  );
}

const ADH_OPTS = [{ v: "yes", l: "Držel jsem plán" }, { v: "partial", l: "Částečně" }, { v: "no", l: "Nedržel" }];
function adhLabel(v) { return v === "yes" ? "Držel plán" : v === "partial" ? "Částečně" : v === "no" ? "Nedržel" : ""; }
const PLAN_SECTIONS = [
  { key: "weekly", letter: "a", label: "Situace — weekly profil", ph: "Týdenní profil, akceptace, kam to vidím…" },
  { key: "daily", letter: "b", label: "Situace — daily profil", ph: "Denní profil, otevření vůči včerejšku…" },
  { key: "auction", letter: "c", label: "Stav aukce", ph: "Kdo má kontrolu, kam se aukce rozšiřuje…" },
];

function MentoringView({ plans, mtrades, fwById, frameworks, instruments, cur, mentorName, tab, setTab, onSavePlan, onNewPlan, onDeletePlan, onImportTrades, onDeleteTrade }) {
  const sortedPlans = useMemo(
    () => [...plans].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    [plans]
  );
  const adh = useMemo(() => {
    const c = { yes: 0, partial: 0, no: 0 };
    plans.forEach((p) => { if (p && c[p.adherence] != null) c[p.adherence]++; });
    return c;
  }, [plans]);
  const s = computeStats(mtrades.filter((t) => !t.missed));

  return (
    <div className="stack mentoring">
      <div className="mtr-head">
        <div className="mtr-when">Mentoring{mentorName && <span className="mtr-mentor">Mentor: {mentorName}</span>}</div>
        <div className="mtr-adh">
          <span className="adh-chip yes">Držel: {adh.yes}</span>
          <span className="adh-chip partial">Částečně: {adh.partial}</span>
          <span className="adh-chip no">Nedržel: {adh.no}</span>
        </div>
      </div>

      <div className="mtr-tabs">
        <button className={tab === "plans" ? "on" : ""} onClick={() => setTab("plans")}>Obchodní plány</button>
        <button className={tab === "trades" ? "on" : ""} onClick={() => setTab("trades")}>Dozorované obchody</button>
      </div>

      {tab === "plans" ? (
        <>
          <div className="mtr-bar"><button className="btn primary sm" onClick={onNewPlan}><Plus size={14} /> Přidat obchodní plán</button></div>
          {sortedPlans.length === 0 ? (
            <div className="card empty-card center"><p>Zatím žádný obchodní plán. Ráno před trhem si rozepiš weekly, daily a stav aukce — jakmile plán uložíš, mentor uvidí, že máš nový.</p></div>
          ) : sortedPlans.map((p) => (
            <PlanCard key={p.id} plan={p} frameworks={frameworks} fwById={fwById} instruments={instruments} cur={cur}
              onSave={(patch) => onSavePlan(p.id, patch)} onDelete={() => onDeletePlan(p.id)} />
          ))}
        </>
      ) : (
        <>
          <div className="mtr-bar">
            <div className="mtr-stats">
              <span>Obchodů <b>{s.n}</b></span>
              <span>Net <b className={s.net >= 0 ? "pos" : "neg"}>{s.n ? fmtMoney(s.net, cur) : "—"}</b></span>
              <span>Win rate <b>{s.n ? `${fmtNum(s.winRate, 0)} %` : "—"}</b></span>
            </div>
            <button className="btn primary sm" onClick={onImportTrades}><Plus size={14} /> Importovat z platformy</button>
          </div>
          <div className="import-note"><ShieldCheck size={14} /> Dozorované obchody jdou jen <b>importovat z platformy</b> — ručně je zadat nelze, aby byly ověřené.</div>
          {mtrades.length === 0 ? (
            <div className="card empty-card center"><p>Zatím žádné dozorované obchody. Naimportuj je z platformy (NinjaTrader CSV) — uloží se jako ověřené a oddělené od osobního deníku.</p></div>
          ) : (
            <div className="card">
              <table className="mtr-tbl">
                <thead><tr><th>Datum</th><th>Symbol</th><th>Směr</th><th>Playbook</th><th className="r">P&L</th><th className="r">R</th><th></th></tr></thead>
                <tbody>
                  {[...mtrades].sort((a, b) => new Date(b.date) - new Date(a.date)).map((t) => {
                    const p = computePnl(t), r = computeR(t), f = fwById[t.frameworkId];
                    return (
                      <tr key={t.id}>
                        <td>{fmtDate(t.date)} <span className="src-badge imp" title="Importováno z platformy"><ShieldCheck size={11} /></span></td>
                        <td>{t.symbol || "—"}</td>
                        <td><span className={`pill ${t.direction}`}>{t.direction === "long" ? "L" : "S"}</span></td>
                        <td>{f ? <><i className="fdot" style={{ background: f.color }} />{f.name}</> : "—"}</td>
                        <td className={`r ${p >= 0 ? "pos" : "neg"}`}>{fmtMoney(p, cur)}</td>
                        <td className="r">{isFinite(r) ? `${fmtNum(r, 2)}R` : "—"}</td>
                        <td className="r nowrap">
                          <button className="ic-btn" onClick={() => onDeleteTrade(t.id)}><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PlanCard({ plan, frameworks, fwById, instruments, cur, onSave, onDelete }) {
  const [d, setD] = useState(plan);
  const [showDebrief, setShowDebrief] = useState(!!(plan.outcome || plan.adherence || plan.lessons || (plan.debriefShots || []).length));
  useEffect(() => { setD(plan); }, [plan]);
  const dirty = JSON.stringify(d) !== JSON.stringify(plan);
  const setF = (k, v) => setD({ ...d, [k]: v });
  const setSec = (sec, patch) => setD({ ...d, [sec]: { ...(d[sec] || { note: "", shots: [] }), ...patch } });

  return (
    <div className="card plan-card">
      <div className="plan-head">
        <div className="plan-when">
          <span className="plan-wd">Obchodní plán</span>
          <input type="date" className="plan-date-in" value={d.date || ""} onChange={(e) => setF("date", e.target.value)} />
        </div>
        <div className="plan-head-r">
          {d.adherence && <span className={`adh-chip ${d.adherence}`}>{adhLabel(d.adherence)}</span>}
          <button className="ic-btn" onClick={onDelete} title="Smazat plán"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="plan-basics">
        <div>
          <label>Trh</label>
          <select value={d.symbol || ""} onChange={(e) => setF("symbol", e.target.value)}>
            <option value="">— vyber trh —</option>
            {instruments.map((i) => <option key={i.symbol} value={i.symbol}>{i.symbol}{i.name ? ` — ${i.name}` : ""}</option>)}
          </select>
        </div>
        <div>
          <label>Framework</label>
          <select value={d.frameworkId || ""} onChange={(e) => setF("frameworkId", e.target.value)}>
            <option value="">— vyber playbook —</option>
            {frameworks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </div>

      {PLAN_SECTIONS.map((sec) => {
        const v = d[sec.key] || { note: "", shots: [] };
        return (
          <div className="plan-sec" key={sec.key}>
            <div className="plan-sec-h"><span className="plan-sec-n">{sec.letter}</span>{sec.label}</div>
            <textarea rows={2} value={v.note || ""} onChange={(e) => setSec(sec.key, { note: e.target.value })} placeholder={sec.ph} />
            <ShotInput large shots={v.shots || []} onChange={(shots) => setSec(sec.key, { shots })} />
          </div>
        );
      })}

      <div className="plan-sec">
        <div className="plan-sec-h"><span className="plan-sec-n">+</span>Popis plánu</div>
        <textarea rows={3} value={d.description || ""} onChange={(e) => setF("description", e.target.value)} placeholder="Celkový záměr: co a proč chci dělat, vstup, stop, cíl…" />
      </div>

      <div className="plan-debrief">
        <button className="debrief-toggle" onClick={() => setShowDebrief((x) => !x)}>
          {showDebrief ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Po trhu (debrief &amp; disciplína)
        </button>
        {showDebrief && (
          <div className="debrief-body">
            <label>Jak to dopadlo</label>
            <textarea rows={2} value={d.outcome || ""} onChange={(e) => setF("outcome", e.target.value)} placeholder="Co se dělo, jak jsem reagoval…" />
            <label>Držel jsem se plánu?</label>
            <div className="adh-pick">
              {ADH_OPTS.map((o) => (
                <button key={o.v} type="button" className={`adh-opt ${o.v} ${d.adherence === o.v ? "on" : ""}`} onClick={() => setF("adherence", o.v)}>{o.l}</button>
              ))}
            </div>
            <label>Co se povedlo / co příště jinak</label>
            <textarea rows={2} value={d.lessons || ""} onChange={(e) => setF("lessons", e.target.value)} placeholder="Plusy a poučení do příště…" />
            <label>Screeny (po trhu)</label>
            <ShotInput large shots={d.debriefShots || []} onChange={(shots) => setF("debriefShots", shots)} />
          </div>
        )}
      </div>

      {plan.mentorComment && (
        <div className="mentor-note">
          <div className="mentor-note-h"><GraduationCap size={14} /> Komentář mentora</div>
          <div className="mentor-note-b">{plan.mentorComment}</div>
        </div>
      )}

      <div className="plan-foot">
        {dirty ? <button className="btn primary sm" onClick={() => onSave(d)}>Uložit plán</button> : <span className="plan-saved">Uloženo ✓</span>}
      </div>
    </div>
  );
}

/* ========================= STYLES ========================= */
function Style() {
  return (<style>{`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
.tz{
  --bg:#F4F6FA; --card:#FFFFFF; --line:#E5E8F0; --line2:#EEF0F6;
  --text:#16203A; --muted:#8A90A2; --soft:#5C6275;
  --accent:#17386F; --accent-soft:#E9EFF8;
  --navy:#0E1E42; --navy-deep:#0A1733; --navy-soft:#19305A;
  --gold:#C2A14A; --gold-bright:#D9BC63; --gold-soft:#F7EFD6;
  --pos:#16A06A; --neg:#E0414A;
  display:flex; min-height:100vh; background:var(--bg); color:var(--text);
  font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased;
  font-variant-numeric:tabular-nums;
}
.tz *{box-sizing:border-box;}
.pos{color:var(--pos);} .neg{color:var(--neg);} .muted,.mut{color:var(--muted);}

/* sidebar */
.side{width:220px;flex-shrink:0;background:var(--navy);border-right:1px solid var(--navy-deep);display:flex;flex-direction:column;padding:18px 14px;position:sticky;top:0;height:100vh;}
.brand{display:flex;justify-content:center;padding:6px 4px 20px;}
.brand-logo{display:block;width:100%;max-width:188px;height:auto;border-radius:8px;}
.mark{display:none;}
.bname{font-weight:700;font-size:15px;letter-spacing:.06em;color:#fff;}
.bname i{font-style:normal;color:var(--gold);font-weight:700;}
.side nav{display:flex;flex-direction:column;gap:3px;flex:1;}
.nav-i{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;border:0;background:transparent;color:#A9B6D1;font-family:inherit;font-size:14px;font-weight:500;cursor:pointer;text-align:left;transition:.13s;}
.nav-i:hover{background:var(--navy-soft);color:#fff;}
.nav-i.on{background:var(--navy-soft);color:var(--gold);font-weight:600;box-shadow:inset 3px 0 0 var(--gold);}
.side-foot{padding-top:12px;border-top:1px solid rgba(255,255,255,.1);}
.acc-switch{display:flex;gap:6px;}
.acc-switch select{flex:1;min-width:0;background:var(--navy-deep);border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:8px 10px;font-size:12.5px;font-family:inherit;color:#D9E1F0;cursor:pointer;outline:none;}
.acc-gear{background:var(--navy-deep);border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:0 9px;color:#A9B6D1;cursor:pointer;display:flex;align-items:center;}
.acc-gear:hover{background:var(--bg);color:var(--text);}
.acc-edit{display:flex;align-items:center;gap:8px;}
.acc-name{flex:1;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:13.5px;font-family:inherit;color:var(--text);outline:none;}
.acc-name:focus{border-color:var(--accent);}
.acc-cur{width:60px;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px;font-size:13.5px;font-family:inherit;text-align:center;color:var(--text);outline:none;}

/* screenshots */
.shots{display:flex;flex-wrap:wrap;gap:10px;}
.shot{position:relative;width:84px;height:64px;border-radius:9px;overflow:hidden;border:1px solid var(--line);}
.shot img{width:100%;height:100%;object-fit:cover;cursor:zoom-in;display:block;}
.shot-del{position:absolute;top:3px;right:3px;background:rgba(10,12,20,.72);border:0;color:#fff;border-radius:6px;width:20px;height:20px;display:grid;place-items:center;cursor:pointer;}
.shot-add{width:84px;height:64px;border:1.5px dashed var(--line);border-radius:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--muted);cursor:pointer;font-size:11px;}
.shot-add:hover{border-color:var(--accent);color:var(--accent);}
.lightbox{position:fixed;inset:0;background:rgba(8,10,18,.86);display:flex;align-items:center;justify-content:center;z-index:1200;padding:32px;cursor:zoom-out;}
.lightbox img{max-width:100%;max-height:100%;border-radius:10px;}
.lb-x{position:absolute;top:20px;right:24px;background:rgba(255,255,255,.12);border:0;color:#fff;width:38px;height:38px;border-radius:10px;display:grid;place-items:center;cursor:pointer;}
.lb-x:hover{background:rgba(255,255,255,.22);}
.cur{display:flex;align-items:center;gap:7px;color:var(--muted);padding:7px 10px;border:1px solid var(--line);border-radius:9px;}
.cur input{width:34px;border:0;background:transparent;color:var(--text);font-size:13px;font-family:inherit;outline:none;text-align:center;}

/* content */
.content{flex:1;min-width:0;display:flex;flex-direction:column;}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:20px 28px;border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0;z-index:4;}
.topbar h1{margin:0;font-size:20px;font-weight:700;letter-spacing:-.01em;}

.btn{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:13.5px;font-weight:600;border:1px solid var(--line);background:var(--card);color:var(--text);padding:9px 15px;border-radius:10px;cursor:pointer;transition:.13s;}
.btn:hover{border-color:#D4D8E4;}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;}
.btn.primary:hover{filter:brightness(1.06);}
.btn.primary:disabled{opacity:.45;cursor:not-allowed;filter:none;}
.btn.ghost{background:transparent;}
.btn.sm{padding:7px 11px;font-size:12.5px;}

.card{background:var(--card);border:1px solid var(--line);border-radius:16px;}
.card-h{font-size:13px;font-weight:600;color:var(--soft);padding:16px 18px 0;}
.card-h .muted{font-weight:500;}

.stack{padding:24px 28px;display:flex;flex-direction:column;gap:18px;}

/* dashboard */
.grid-dash{padding:24px 28px;display:grid;gap:18px;grid-template-columns:340px 1fr;grid-template-areas:'score kpis' 'equity equity' 'recent recent';}
.score-card{grid-area:score;}
.kpis{grid-area:kpis;display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
.equity-card{grid-area:equity;padding-bottom:14px;}
.recent-card{grid-area:recent;}
.score-body{display:flex;align-items:center;gap:6px;padding:6px 14px 18px;}
.gauge{flex-shrink:0;}
.g-num{font-size:30px;font-weight:700;}
.g-lbl{font-size:11px;fill:var(--muted);}
.radar{flex:1;min-width:0;}

.kpi{padding:16px 18px;display:flex;flex-direction:column;gap:5px;justify-content:center;}
.kpi-l{font-size:12px;color:var(--muted);font-weight:500;}
.kpi-v{font-size:20px;font-weight:700;letter-spacing:-.01em;}
.kpi-big .kpi-v{font-size:26px;}
.kpi-s{font-size:11.5px;color:var(--muted);}

.recent-list{padding:6px 8px 10px;}
.recent-row{display:flex;align-items:center;justify-content:space-between;padding:10px 10px;border-radius:10px;}
.recent-row:hover{background:var(--bg);}
.rr-l{display:flex;align-items:center;gap:11px;}
.pill{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:11px;font-weight:700;}
.pill.long{background:rgba(22,199,132,.14);color:var(--pos);}
.pill.short{background:rgba(240,69,78,.14);color:var(--neg);}
.rr-sym{font-weight:600;font-size:14px;}
.rr-meta{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;}
.rr-pnl{font-weight:700;font-size:14px;}
.fdot{width:8px;height:8px;border-radius:50%;display:inline-block;}
.fdot.lg{width:11px;height:11px;}

.tip{background:#fff;border:1px solid var(--line);border-radius:9px;padding:8px 11px;box-shadow:0 4px 14px rgba(20,25,50,.08);}
.tip-l{font-size:11px;color:var(--muted);}
.tip-v{font-weight:700;font-size:14px;}

/* filters / table */
.filters{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.search{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 13px;flex:1;min-width:220px;color:var(--muted);}
.search input{flex:1;border:0;background:transparent;font-size:13.5px;color:var(--text);outline:none;font-family:inherit;}
.filters select{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:13.5px;font-family:inherit;color:var(--text);cursor:pointer;outline:none;}
.count{margin-left:auto;font-size:12.5px;color:var(--muted);}

.table-wrap{overflow:hidden;}
.tbl{width:100%;border-collapse:collapse;font-size:13.5px;}
.tbl thead th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;padding:13px 16px;border-bottom:1px solid var(--line);}
.tbl th.r,.tbl td.r{text-align:right;}
.tbl tbody tr{border-bottom:1px solid var(--line2);cursor:pointer;transition:background .1s;}
.tbl tbody tr:last-child{border-bottom:0;}
.tbl tbody tr:hover{background:var(--bg);}
.tbl td{padding:13px 16px;}
.tbl td.sym{font-weight:700;}
.tbl td.strong{font-weight:700;}
.dir{font-size:10px;font-weight:700;letter-spacing:.04em;padding:3px 7px;border-radius:5px;}
.dir.long{background:rgba(22,199,132,.13);color:var(--pos);}
.dir.short{background:rgba(240,69,78,.13);color:var(--neg);}
.fwtag{display:inline-flex;align-items:center;gap:6px;font-weight:500;}
.fwtag i{width:8px;height:8px;border-radius:50%;}
.act{display:flex;gap:4px;justify-content:flex-end;}
.act button{background:transparent;border:0;color:var(--muted);padding:5px;border-radius:6px;cursor:pointer;display:flex;}
.act button:hover{background:var(--bg);color:var(--text);}

/* daily journal */
.dj-intro{margin:0;font-size:14px;color:var(--soft);max-width:620px;}
.day-card{padding:18px 20px;display:flex;flex-direction:column;gap:14px;}
.day-head{display:flex;align-items:flex-start;justify-content:space-between;}
.day-when{display:flex;flex-direction:column;gap:2px;}
.day-wd{font-size:15px;font-weight:700;text-transform:capitalize;display:flex;align-items:center;gap:8px;}
.today-badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:var(--accent-soft);color:var(--accent);padding:2px 7px;border-radius:5px;}
.day-date{font-size:12.5px;color:var(--muted);}
.day-pnl{font-size:20px;font-weight:700;}
.day-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:13px 0;border-top:1px solid var(--line2);border-bottom:1px solid var(--line2);}
.day-stats>div{display:flex;flex-direction:column;gap:3px;}
.day-stats span{font-size:11px;color:var(--muted);}
.day-stats b{font-size:15px;font-weight:700;display:flex;align-items:baseline;gap:6px;}
.day-stats .wl{font-size:11px;font-weight:500;color:var(--muted);font-style:normal;}
.day-trades{display:flex;flex-direction:column;gap:2px;}
.dt-row{display:grid;grid-template-columns:24px 48px 1fr 1.4fr 64px 92px;align-items:center;gap:10px;padding:9px 8px;border-radius:9px;cursor:pointer;font-size:13.5px;}
.dt-row:hover{background:var(--bg);}
.dt-time{color:var(--muted);font-size:12px;}
.dt-sym{font-weight:700;}
.dt-fw{color:var(--soft);font-size:12.5px;display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dt-r{text-align:right;font-weight:600;font-size:12.5px;}
.dt-pnl{text-align:right;font-weight:700;}
.day-empty{font-size:13.5px;color:var(--muted);padding:6px 2px;line-height:1.5;}
.linkbtn{background:none;border:0;color:var(--accent);font-family:inherit;font-size:inherit;font-weight:600;cursor:pointer;padding:0;text-decoration:underline;}
.day-note{display:flex;flex-direction:column;gap:8px;}
.day-note-h{display:flex;align-items:center;justify-content:space-between;}
.day-note-h>span{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--soft);text-transform:uppercase;letter-spacing:.03em;}
.tmpl-btn{background:var(--accent-soft);border:0;color:var(--accent);font-family:inherit;font-size:12px;font-weight:600;padding:5px 10px;border-radius:7px;cursor:pointer;}
.tmpl-btn:hover{filter:brightness(.97);}
.day-note textarea{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 12px;color:var(--text);font-size:13.5px;font-family:inherit;line-height:1.55;outline:none;resize:vertical;width:100%;}
.day-note textarea:focus{border-color:var(--accent);background:var(--card);}

/* notebook */
.nb-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.nb-folders{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.fchip{display:inline-flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:7px 13px;font-family:inherit;font-size:13px;font-weight:500;color:var(--soft);cursor:pointer;}
.fchip:hover{border-color:#D4D8E4;}
.fchip.on{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600;}
.fchip i{font-style:normal;font-size:11px;color:var(--muted);background:var(--bg);padding:1px 6px;border-radius:8px;}
.fchip.on i{background:#fff;color:var(--accent);}
.fchip.add{color:var(--accent);border-style:dashed;}
.nb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:14px;}
.note-card{padding:16px;display:flex;flex-direction:column;gap:9px;cursor:pointer;min-height:142px;transition:.13s;}
.note-card:hover{border-color:#D4D8E4;box-shadow:0 4px 16px rgba(20,25,50,.05);}
.note-h{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}
.note-title{font-weight:700;font-size:14.5px;line-height:1.3;}
.note-del{background:transparent;border:0;color:var(--muted);cursor:pointer;padding:3px;border-radius:6px;display:flex;flex-shrink:0;}
.note-del:hover{background:var(--bg);color:var(--neg);}
.note-snip{margin:0;font-size:12.5px;color:var(--muted);line-height:1.55;flex:1;white-space:pre-wrap;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;}
.note-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.note-folder{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--soft);font-weight:500;}
.note-tag{font-size:11px;color:var(--accent);background:var(--accent-soft);padding:2px 7px;border-radius:6px;}
.note-date{margin-left:auto;font-size:11px;color:var(--muted);}
.tag-input{display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px;}
.tag-input:focus-within{border-color:var(--accent);}
.tag-input input{flex:1;min-width:120px;border:0;background:transparent;font-size:14px;font-family:inherit;outline:none;color:var(--text);padding:2px;}
.chip{display:inline-flex;align-items:center;gap:4px;background:var(--accent-soft);color:var(--accent);font-size:12.5px;font-weight:600;padding:3px 4px 3px 9px;border-radius:7px;}
.chip button{background:transparent;border:0;color:var(--accent);cursor:pointer;display:flex;padding:1px;border-radius:4px;}
.chip button:hover{background:rgba(23,56,111,.2);}
.btn.danger{color:var(--neg);}
.btn.danger:hover{border-color:var(--neg);}
.sheet-f .danger{margin-right:auto;}

/* reports */
.rep-filter{display:flex;align-items:center;justify-content:space-between;gap:12px;}
.seg{display:inline-flex;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:3px;gap:2px;}
.seg-btn{border:0;background:transparent;font-family:inherit;font-size:13px;font-weight:600;color:var(--soft);padding:7px 14px;border-radius:8px;cursor:pointer;}
.seg-btn:hover{color:var(--text);}
.seg-btn.on{background:var(--accent);color:#fff;}
.rep-count{font-size:12.5px;color:var(--muted);}
.insights{padding-bottom:16px;}
.ins-list{display:flex;flex-direction:column;gap:8px;padding:12px 18px 0;}
.ins-empty,.report-empty{color:var(--muted);font-size:13px;padding:24px 4px;text-align:center;}
.ins-item{display:flex;align-items:center;gap:10px;font-size:13.5px;font-weight:500;}
.ins-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.ins-item.good .ins-dot{background:var(--pos);}
.ins-item.bad .ins-dot{background:var(--neg);}
.reports-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.report-card{padding:16px 18px 18px;}
.report-h{font-size:13px;font-weight:600;color:var(--soft);margin-bottom:10px;}
.report-h .muted{font-weight:500;}
.sym-list{display:flex;flex-direction:column;gap:4px;}
.sym-row{display:grid;grid-template-columns:80px 1fr 130px 100px;align-items:center;gap:12px;padding:7px 4px;font-size:13px;}
.sym-name{font-weight:700;}
.sym-track{height:8px;background:var(--line2);border-radius:5px;overflow:hidden;}
.sym-bar{height:100%;border-radius:5px;}
.sym-bar.pos{background:var(--pos);} .sym-bar.neg{background:var(--neg);}
.sym-meta{font-size:11.5px;color:var(--muted);text-align:right;}
.sym-net{font-weight:700;text-align:right;}
.lsplit{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.ls-block{background:var(--bg);border:1px solid var(--line2);border-radius:12px;padding:16px;}
.ls-head{margin-bottom:8px;}
.ls-net{font-size:22px;font-weight:700;margin-bottom:12px;}
.ls-stats{display:flex;flex-direction:column;gap:7px;}
.ls-stats>div{display:flex;align-items:baseline;justify-content:space-between;}
.ls-stats span{font-size:12px;color:var(--muted);}
.ls-stats b{font-size:14px;font-weight:700;}

/* progress tracker */
.pg-grid{display:grid;grid-template-columns:300px 1fr;gap:18px;}
.pg-score{display:flex;flex-direction:column;align-items:center;padding:18px;gap:6px;}
.pg-daynav{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;margin-bottom:4px;}
.pg-daynav span{font-size:14px;font-weight:700;text-transform:capitalize;flex:1;text-align:center;}
.pg-daynav button{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:5px;cursor:pointer;display:flex;color:var(--soft);}
.pg-daynav button:hover:not(:disabled){background:var(--bg);}
.pg-daynav button:disabled{opacity:.35;cursor:default;}
.pg-score-sub{font-size:13px;color:var(--muted);}
.pg-rules{padding:16px 18px 18px;}
.pg-rule-list{display:flex;flex-direction:column;gap:6px;}
.pg-rule{display:flex;align-items:center;gap:11px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:11px 13px;font-family:inherit;font-size:13.5px;color:var(--text);cursor:pointer;text-align:left;width:100%;}
.pg-rule:hover:not(:disabled){border-color:#D4D8E4;}
.pg-rule.on{background:rgba(22,199,132,.08);border-color:rgba(22,199,132,.4);}
.pg-rule .rbox{border-color:var(--line);}
.pg-rule.on .rbox{background:var(--pos);border-color:var(--pos);}
.pg-rule.is-auto{cursor:default;}
.pg-rule-name{flex:1;}
.auto-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--accent);background:var(--accent-soft);padding:2px 7px;border-radius:5px;}
.manual-tag{font-size:10px;font-weight:600;color:var(--muted);background:var(--bg);padding:2px 7px;border-radius:5px;}
.pg-heat{padding:16px 18px 18px;}
.heat{display:flex;gap:4px;overflow-x:auto;padding-bottom:4px;}
.heat-col{display:flex;flex-direction:column;gap:4px;}
.heat-cell{width:15px;height:15px;border-radius:4px;border:0;padding:0;cursor:pointer;background:#EEF0F6;}
.heat-cell.future{background:transparent;cursor:default;}
.heat-cell.lvl0{background:#EEF0F6;}
.heat-cell.lvl1{background:#DDD3FB;}
.heat-cell.lvl2{background:#B7A1F7;}
.heat-cell.lvl3{background:#9072F0;}
.heat-cell.lvl4{background:#17386F;}
.heat-cell.sel{outline:2px solid var(--text);outline-offset:1px;}
.heat-legend{display:flex;align-items:center;gap:4px;margin-top:10px;font-size:11px;color:var(--muted);}
.heat-legend i{width:13px;height:13px;border-radius:3px;display:inline-block;}
.heat-legend span:first-child{margin-right:2px;}.heat-legend span:last-child{margin-left:2px;}

.rule-edit{display:flex;align-items:center;gap:10px;}
.mini-tgl{display:flex;cursor:pointer;}
.mini-tgl input{display:none;}
.mini-tgl .tgl-box{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--line);display:grid;place-items:center;color:#fff;}
.mini-tgl input:checked + .tgl-box{background:var(--accent);border-color:var(--accent);}
.rule-name-in{flex:1;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:13.5px;font-family:inherit;color:var(--text);outline:none;}
.rule-name-in:focus{border-color:var(--accent);}
.rule-val{width:74px;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px;font-size:13px;font-family:inherit;text-align:right;outline:none;}
.rule-del{background:transparent;border:0;color:var(--muted);cursor:pointer;padding:5px;border-radius:6px;display:flex;}
.rule-del:hover{background:var(--bg);color:var(--neg);}

/* csv import */
.sheet.wide{width:min(700px,100%);}
.csv-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:44px;border:1.5px dashed var(--line);border-radius:12px;color:var(--muted);cursor:pointer;text-align:center;font-size:14px;}
.csv-drop:hover{border-color:var(--accent);color:var(--accent);}
.csv-drop svg{color:var(--accent);}
.csv-file{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 12px;}
.csv-file .btn{margin-left:auto;}
.map-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.map-row{display:flex;flex-direction:column;gap:5px;}
.map-l{font-size:11.5px;color:var(--soft);font-weight:600;}
.map-row select{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-size:13.5px;font-family:inherit;color:var(--text);outline:none;cursor:pointer;}
.map-row select:focus{border-color:var(--accent);}
.csv-prev-h{font-size:12px;font-weight:600;color:var(--soft);text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;}
.csv-table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;}
.csv-table th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);font-weight:600;padding:9px 11px;border-bottom:1px solid var(--line);}
.csv-table td{padding:9px 11px;border-bottom:1px solid var(--line2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;}
.csv-table tr:last-child td{border-bottom:0;}

.eq-head{display:flex;align-items:center;justify-content:space-between;}
.nt-badge{background:#E9FBF1;color:#0F9D58;border:1px solid #BFEFD4;border-radius:9px;padding:9px 13px;font-size:13px;margin-bottom:12px;}
.empty-btns{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;}
.csv-more{padding:8px 11px;font-size:12px;color:var(--muted);}

/* mentoring */
.mentor-lock{display:flex;justify-content:center;padding:30px 0;}
.lock-card{max-width:520px;}
.lock-card h2{margin:10px 0 6px;font-size:19px;}
.lock-card p{color:var(--soft);font-size:14px;line-height:1.55;margin-bottom:16px;}
.lock-row{display:flex;gap:8px;width:100%;}
.lock-row input{flex:1;padding:11px 13px;border:1px solid var(--line);border-radius:10px;font-size:15px;letter-spacing:1px;text-transform:uppercase;font-family:inherit;}
.lock-err{margin-top:10px;color:#F0454E;font-size:13px;}
.mtr-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;}
.mtr-when{font-size:15px;font-weight:700;display:flex;align-items:center;gap:10px;}
.mtr-mentor{font-size:12px;font-weight:600;color:var(--muted);background:#F7EFD6;border:1px solid #ECD9A8;padding:3px 9px;border-radius:20px;}
.mtr-adh{display:flex;gap:6px;flex-wrap:wrap;}
.adh-chip{font-size:12px;font-weight:600;padding:3px 9px;border-radius:20px;border:1px solid var(--line);}
.adh-chip.yes{background:#E9FBF1;color:#0F9D58;border-color:#BFEFD4;}
.adh-chip.partial{background:#FFF6E6;color:#B7791F;border-color:#F3E0B5;}
.adh-chip.no{background:#FDECEC;color:#E0414A;border-color:#F6CBCD;}
.mtr-tabs{display:flex;gap:6px;border-bottom:1px solid var(--line);}
.mtr-tabs button{background:none;border:none;padding:9px 14px;font-family:inherit;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;}
.mtr-tabs button.on{color:var(--text);border-bottom-color:var(--gold);}
.mtr-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;}
.mtr-stats{display:flex;gap:16px;font-size:13px;color:var(--soft);}
.mtr-stats b{color:var(--text);}
.btn.sm{padding:7px 12px;font-size:13px;}
.plan-card{padding:0;overflow:hidden;}
.plan-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line2);flex-wrap:wrap;gap:8px;}
.plan-when{display:flex;flex-direction:column;}
.plan-wd{font-weight:700;text-transform:capitalize;}
.plan-date{font-size:12px;color:var(--muted);}
.plan-head-r{display:flex;align-items:center;gap:8px;}
.plan-pnl{font-weight:700;font-size:13px;}
.plan-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:16px;}
.plan-col h4{margin:0 0 10px;font-size:13px;color:var(--soft);}
.plan-col label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px;}
.plan-col textarea{width:100%;border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-family:inherit;font-size:13.5px;resize:vertical;line-height:1.5;}
.adh-pick{display:flex;gap:6px;flex-wrap:wrap;}
.adh-opt{padding:7px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;font-family:inherit;font-size:13px;font-weight:600;color:var(--soft);cursor:pointer;}
.adh-opt.on.yes{background:#E9FBF1;color:#0F9D58;border-color:#0F9D58;}
.adh-opt.on.partial{background:#FFF6E6;color:#B7791F;border-color:#B7791F;}
.adh-opt.on.no{background:#FDECEC;color:#E0414A;border-color:#E0414A;}
.mentor-note{margin:0 16px 14px;background:#F7EFD6;border:1px solid #ECD9A8;border-radius:10px;padding:11px 13px;}
.mentor-note-h{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#17386F;margin-bottom:5px;}
.mentor-note-b{font-size:13.5px;color:var(--text);line-height:1.55;white-space:pre-wrap;}
.plan-foot{padding:0 16px 14px;display:flex;justify-content:flex-end;}
.plan-saved{font-size:12.5px;color:#0F9D58;font-weight:600;}
.plan-date-in{border:1px solid var(--line);border-radius:7px;padding:3px 8px;font-family:inherit;font-size:12px;color:var(--soft);}
.plan-basics{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:14px 16px;border-bottom:1px solid var(--line2);}
.plan-basics label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px;}
.plan-basics select{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-family:inherit;font-size:13.5px;background:#fff;color:var(--text);}
.plan-sec{padding:14px 16px;border-bottom:1px solid var(--line2);}
.plan-sec-h{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;margin-bottom:9px;}
.plan-sec-n{width:18px;height:18px;border-radius:50%;background:#F7EFD6;color:#17386F;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;}
.plan-sec textarea{width:100%;border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-family:inherit;font-size:13.5px;resize:vertical;line-height:1.5;}
.shots.large{flex-direction:column;align-items:stretch;gap:10px;margin-top:10px;}
.shots.large .shot{width:100%;}
.shots.large .shot img{width:100%;max-height:300px;object-fit:contain;background:#0E1320;border:1px solid var(--line);border-radius:9px;cursor:zoom-in;display:block;}
.shots.large .shot-del{top:8px;right:8px;}
.shots.large .shot-add{align-self:flex-start;}
.plan-debrief{padding:6px 16px 4px;}
.debrief-toggle{display:flex;align-items:center;gap:6px;background:none;border:none;font-family:inherit;font-size:13px;font-weight:600;color:var(--soft);cursor:pointer;padding:8px 0;}
.debrief-body{padding-bottom:8px;}
.debrief-body label{display:block;font-size:12px;color:var(--muted);margin:8px 0 4px;}
.debrief-body textarea{width:100%;border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-family:inherit;font-size:13.5px;resize:vertical;line-height:1.5;}
.mtr-tbl{width:100%;border-collapse:collapse;font-size:13.5px;}
.mtr-tbl th{text-align:left;padding:10px 12px;color:var(--muted);font-weight:600;font-size:12px;border-bottom:1px solid var(--line);}
.mtr-tbl td{padding:10px 12px;border-bottom:1px solid var(--line2);}
.mtr-tbl th.r,.mtr-tbl td.r{text-align:right;}
.mtr-tbl td.nowrap{white-space:nowrap;}
.ic-btn{background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;border-radius:6px;}
.ic-btn:hover{background:var(--line2);color:var(--text);}
.verif-strip{grid-column:1/-1;display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;border:1px solid var(--line);background:var(--card);}
.verif-strip.ok{border-color:#BFE6D2;background:#F1FBF6;color:#0F8A5A;}
.verif-strip.warn{border-color:#F0DDB0;background:#FFF8EC;color:#9A6A12;}
.verif-strip svg{flex-shrink:0;}
.vs-text{display:flex;flex-direction:column;line-height:1.3;}
.vs-text b{font-size:13.5px;}
.vs-text span{font-size:12px;color:var(--soft);}
.vs-pct{margin-left:auto;display:flex;align-items:center;gap:10px;}
.vs-pct b{font-size:12.5px;white-space:nowrap;}
.vs-bar{width:120px;height:7px;border-radius:5px;background:#E7EAF2;overflow:hidden;}
.vs-bar i{display:block;height:100%;background:var(--gold);}
.verif-strip.ok .vs-bar i{background:#16A06A;}
.src-badge{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:5px;margin-left:6px;vertical-align:middle;}
.src-badge.imp{background:#EAF4EF;color:#0F8A5A;}
.src-badge.man{background:#F3F0E6;color:#A67C18;}
.import-note{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--soft);background:#F7F8FB;border:1px solid var(--line);border-radius:9px;padding:8px 11px;}
.import-note svg{color:var(--gold);flex-shrink:0;}
.import-note b{color:var(--text);}
@media(max-width:760px){.plan-grid{grid-template-columns:1fr;}}
.sm-seg{padding:2px;}
.sm-seg .seg-btn{padding:5px 11px;font-size:12px;}

/* chart modal */
.sheet-h-act{display:flex;align-items:center;gap:10px;}
.chart-sheet{width:min(1040px,96vw);max-width:96vw;height:min(80vh,720px);display:flex;flex-direction:column;}
.chart-body{flex:1;min-height:0;padding:0 14px;}
.chart-body .tradingview-widget-container{border:1px solid var(--line);border-radius:12px;overflow:hidden;}
.chart-note{padding:10px 16px 14px;font-size:11.5px;color:var(--muted);line-height:1.5;}
.act button[title="Graf"]:hover{color:var(--accent);}

/* calendar */
.cal-card{padding:18px;}
.cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.cal-nav{display:flex;align-items:center;gap:10px;}
.cal-nav button{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px;cursor:pointer;display:flex;color:var(--soft);}
.cal-nav button:hover{background:var(--bg);}
.cal-title{font-size:16px;font-weight:700;text-transform:capitalize;min-width:150px;text-align:center;}
.cal-total{font-size:16px;font-weight:700;}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr) 1fr;gap:6px;margin-bottom:6px;}
.cal-grid.head{margin-bottom:8px;}
.cal-dow{font-size:11px;color:var(--muted);font-weight:600;text-align:center;padding:2px;}
.cal-cell{aspect-ratio:1.05;border:1px solid var(--line2);border-radius:10px;padding:7px 8px;display:flex;flex-direction:column;gap:2px;background:var(--card);min-height:62px;}
.cal-cell.empty-cell{background:transparent;border:0;}
.cal-cell.pos{background:rgba(22,199,132,.10);border-color:rgba(22,199,132,.25);}
.cal-cell.neg{background:rgba(240,69,78,.09);border-color:rgba(240,69,78,.22);}
.cal-cell.flat{background:var(--bg);}
.cal-d{font-size:12px;font-weight:600;color:var(--soft);}
.cal-pnl{font-size:13px;font-weight:700;margin-top:auto;}
.cal-cell.pos .cal-pnl{color:var(--pos);} .cal-cell.neg .cal-pnl{color:var(--neg);}
.cal-n{font-size:10.5px;color:var(--muted);}
.cal-cell.week{background:var(--bg);border-style:dashed;}
.cal-wl{font-size:10.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;}
.cal-cell.week.pos .cal-pnl{color:var(--pos);} .cal-cell.week.neg .cal-pnl{color:var(--neg);}

/* frameworks */
.fw-top{display:flex;align-items:center;justify-content:space-between;gap:16px;}
.fw-intro{margin:0;font-size:14px;color:var(--soft);max-width:560px;}
.fw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;}
.fw-card{padding:18px;display:flex;flex-direction:column;gap:12px;}
.fw-card.muted-card{opacity:.85;}
.fw-card-h{display:flex;align-items:center;justify-content:space-between;}
.fw-name{display:flex;align-items:center;gap:9px;font-weight:700;font-size:15px;}
.fw-acts{display:flex;gap:4px;}
.fw-acts button{background:transparent;border:0;color:var(--muted);padding:5px;border-radius:6px;cursor:pointer;display:flex;}
.fw-acts button:hover{background:var(--bg);color:var(--text);}
.fw-desc{margin:0;font-size:12.5px;color:var(--muted);line-height:1.5;}
.fw-stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.fw-stats>div{display:flex;flex-direction:column;gap:2px;}
.fw-stats span{font-size:11px;color:var(--muted);}
.fw-stats b{font-size:16px;font-weight:700;}
.fw-bar{height:6px;border-radius:4px;background:var(--line2);overflow:hidden;}
.fw-bar-fill{height:100%;border-radius:4px;}
.fw-meta{display:flex;gap:6px;flex-wrap:wrap;}
.fw-pill{font-size:11px;font-weight:600;color:var(--soft);background:var(--bg);border:1px solid var(--line2);padding:2px 8px;border-radius:6px;}
.fw-pill.miss{color:#B45309;background:#FEF3C7;border-color:#FDE68A;}
.fw-adh{display:flex;flex-direction:column;gap:6px;}
.fw-adh-h{display:flex;align-items:baseline;justify-content:space-between;font-size:12px;color:var(--muted);}
.fw-adh-h b{font-size:13px;color:var(--text);font-weight:700;}

/* rule checklist (trade form) */
.rulecheck{display:flex;flex-direction:column;gap:6px;}
.rcheck{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 11px;font-family:inherit;font-size:13.5px;color:var(--text);cursor:pointer;text-align:left;}
.rcheck:hover{border-color:#D4D8E4;}
.rcheck.on{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600;}
.rbox{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--line);display:grid;place-items:center;flex-shrink:0;color:#fff;}
.rcheck.on .rbox{background:var(--accent);border-color:var(--accent);}
.rules-edit{display:flex;flex-direction:column;gap:8px;}
.rule-row{display:flex;gap:8px;}
.rule-row input{flex:1;}
.rule-row button{background:transparent;border:1px solid var(--line);border-radius:8px;color:var(--muted);cursor:pointer;padding:0 10px;display:flex;align-items:center;}
.rule-row button:hover{border-color:var(--neg);color:var(--neg);}
.add-rule{align-self:flex-start;}

/* rating + toggles */
.rating{display:flex;gap:8px;}
.rb{flex:1;padding:9px;border:1px solid var(--line);border-radius:9px;background:var(--card);font-family:inherit;font-weight:700;font-size:13.5px;color:var(--soft);cursor:pointer;}
.rb:hover{border-color:#D4D8E4;}
.rb.on{background:var(--accent);border-color:var(--accent);color:#fff;}
.toggles{display:flex;gap:10px;flex-wrap:wrap;}
.tgl{display:flex;align-items:center;gap:9px;font-size:13.5px;font-weight:500;color:var(--soft);cursor:pointer;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 13px;flex:1;}
.tgl input{display:none;}
.tgl-box{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--line);display:grid;place-items:center;color:#fff;flex-shrink:0;}
.tgl.on{border-color:var(--pos);color:var(--pos);background:rgba(22,199,132,.08);font-weight:600;}
.tgl.on .tgl-box{background:var(--pos);border-color:var(--pos);}
.tgl.on.miss{border-color:#F59E0B;color:#B45309;background:#FEF9EC;}
.tgl.on.miss .tgl-box{background:#F59E0B;border-color:#F59E0B;}
.hint-line{margin:-6px 0 0;font-size:12px;color:var(--muted);line-height:1.5;}
.tag-input.bad:focus-within{border-color:var(--neg);}
.chip.bad{background:rgba(240,69,78,.1);color:var(--neg);}
.chip.bad button{color:var(--neg);}
.chip.bad button:hover{background:rgba(240,69,78,.18);}

/* table indicators */
.cellflags{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;}
.rev-check{color:var(--pos);margin-left:6px;vertical-align:middle;}
.rtag{font-size:10.5px;font-weight:700;color:var(--accent);background:var(--accent-soft);padding:1px 6px;border-radius:5px;}
.missbadge{font-size:9.5px;font-weight:700;letter-spacing:.04em;color:#B45309;background:#FEF3C7;padding:2px 6px;border-radius:5px;}
.row-missed{opacity:.62;}

/* empty */
.empty,.empty.small{padding:50px;text-align:center;color:var(--muted);font-size:14px;}
.empty-hero{padding:60px 28px;display:flex;justify-content:center;}
.empty-card.center{max-width:460px;text-align:center;padding:40px;margin:0 auto;color:var(--muted);}
.empty-card svg{color:var(--accent);margin-bottom:12px;}
.empty-card h2{color:var(--text);font-size:19px;margin:0 0 10px;font-weight:700;}
.empty-card p{font-size:14px;line-height:1.55;margin:0 0 22px;}
.empty-card .btn{margin:0 auto;}

/* sheet */
.overlay{position:fixed;inset:0;background:rgba(20,24,40,.4);backdrop-filter:blur(2px);display:flex;justify-content:flex-end;z-index:1000;}
.sheet{width:min(540px,100%);height:100%;background:var(--bg);border-left:1px solid var(--line);display:flex;flex-direction:column;animation:sl .22s ease;}
.sheet.narrow{width:min(440px,100%);}
@keyframes sl{from{transform:translateX(28px);opacity:.5;}to{transform:none;opacity:1;}}
.sheet-h{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line);background:var(--card);}
.sheet-h h3{margin:0;font-size:16px;font-weight:700;}
.sheet-h .x{background:transparent;border:0;color:var(--muted);cursor:pointer;padding:4px;}
.sheet-h .x:hover{color:var(--text);}
.sheet-b{padding:22px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:16px;}
.sheet-f{display:flex;gap:10px;justify-content:flex-end;padding:16px 22px;border-top:1px solid var(--line);background:var(--card);}

.dirtog{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.dirtog button{display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--muted);font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;}
.dirtog .on.long{background:rgba(22,199,132,.12);border-color:var(--pos);color:var(--pos);}
.dirtog .on.short{background:rgba(240,69,78,.12);border-color:var(--neg);color:var(--neg);}

.field{display:flex;flex-direction:column;gap:6px;}
.field-l{font-size:11.5px;color:var(--soft);font-weight:600;text-transform:uppercase;letter-spacing:.03em;}
.field-l em{text-transform:none;letter-spacing:0;font-style:normal;color:var(--muted);font-weight:500;}
.field input,.field textarea,.field select{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--text);font-size:14px;font-family:inherit;outline:none;width:100%;}
.field input:focus,.field textarea:focus,.field select:focus{border-color:var(--accent);}
.field input:disabled{opacity:.45;}
.field textarea{resize:vertical;}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.fwrow{display:flex;gap:8px;}
.fwrow select,.fwrow input{flex:1;}
.swatches{display:flex;gap:8px;flex-wrap:wrap;}
.sw{width:30px;height:30px;border-radius:8px;border:2px solid transparent;cursor:pointer;}
.sw.on{border-color:var(--text);box-shadow:0 0 0 2px #fff inset;}

.live{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;}
.live>div{display:flex;flex-direction:column;gap:4px;}
.live-l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:600;}
.live-v{font-size:22px;font-weight:700;}

@media(max-width:900px){
  .tz{flex-direction:column;}
  .side{width:100%;height:auto;position:sticky;top:0;flex-direction:row;align-items:center;padding:10px 14px;z-index:6;}
  .brand{padding:0;margin-right:8px;}.bname,.side-foot{display:none;}
  .side nav{flex-direction:row;overflow-x:auto;gap:4px;}
  .nav-i span{display:none;}.nav-i{padding:10px;}
  .grid-dash{grid-template-columns:1fr;grid-template-areas:'score' 'kpis' 'equity' 'recent';}
  .kpis{grid-template-columns:repeat(2,1fr);}
  .cal-grid{grid-template-columns:repeat(7,1fr);}
  .cal-cell.week{display:none;}
  .day-stats{grid-template-columns:repeat(2,1fr);}
  .reports-grid{grid-template-columns:1fr;}
  .pg-grid{grid-template-columns:1fr;}
  .sym-row{grid-template-columns:64px 1fr 84px;}
  .sym-meta{display:none;}
  .lsplit{grid-template-columns:1fr;}
  .map-grid{grid-template-columns:1fr;}
  .dt-row{grid-template-columns:22px 1fr 70px 84px;}
  .dt-time,.dt-fw{display:none;}
  .g3,.g2{grid-template-columns:1fr;}
  .tbl thead{display:none;}.tbl,.tbl tbody,.tbl tr,.tbl td{display:block;width:100%;}
  .tbl tr{padding:8px 6px;}.tbl td{padding:4px 16px;text-align:left!important;}
}
`}</style>);
}
