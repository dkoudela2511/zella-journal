import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };

// kořen symbolu: "6A 09-26" -> "6A", "MESU6@CME" -> "MESU6" (obchody řeší root jinde)
function barRoot(symbol) {
  return String(symbol || "").trim().split(/[\s@]+/)[0].toUpperCase();
}

// "20260630 220100" -> Date (wall-clock uložený jako UTC složky – konzistentně s obchody)
function parseBarTime(s) {
  const m = String(s).trim().match(/^(\d{4})(\d{2})(\d{2})\s+(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = +m[6];
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return isNaN(dt) ? null : dt;
}

// NinjaTrader export: "20260630 220100;0.69095;0.69115;0.69085;0.691;386"
function parseNinjaBars(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim(); if (!t) continue;
    const p = t.split(";");
    if (p.length < 5) continue;
    const time = parseBarTime(p[0]);
    const open = num(p[1]), high = num(p[2]), low = num(p[3]), close = num(p[4]);
    const volume = Math.round(num(p[5]) || 0);
    if (!time || open == null || high == null || low == null || close == null) continue;
    out.push({ time, open, high, low, close, volume });
  }
  return out;
}

// POST /api/bars — příjem barů z NinjaTraderu/scriptu. Auth: token (Bearer nebo body.token).
// Tělo: { symbol, data }  (data = surový text z exportu)  NEBO  { symbol, bars: [[t,o,h,l,c,v]...] }
export async function POST(req) {
  const token = process.env.BARS_TOKEN;
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const body = await req.json().catch(() => ({}));
  const given = bearer || body.token;
  if (!token || given !== token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const symbol = String(body.symbol || "").trim();
  if (!symbol) return NextResponse.json({ error: "missing symbol" }, { status: 400 });
  const root = barRoot(symbol);

  let rows = [];
  if (typeof body.data === "string") {
    rows = parseNinjaBars(body.data);
  } else if (Array.isArray(body.bars)) {
    rows = body.bars.map((b) => {
      const arr = Array.isArray(b);
      const g = (k, i) => (arr ? b[i] : b[k]);
      const tRaw = arr ? b[0] : (b.t ?? b.time);
      const time = (typeof tRaw === "string" && /^\d{8}\s/.test(tRaw)) ? parseBarTime(tRaw) : new Date(tRaw);
      return { time, open: num(g("o", 1)), high: num(g("h", 2)), low: num(g("l", 3)), close: num(g("c", 4)), volume: Math.round(num(g("v", 5)) || 0) };
    }).filter((b) => b.time && !isNaN(b.time) && b.open != null && b.high != null && b.low != null && b.close != null);
  }
  if (!rows.length) return NextResponse.json({ error: "no valid bars" }, { status: 400 });

  const data = rows.map((b) => ({ symbol, root, time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  let inserted = 0;
  const CHUNK = 1000;
  for (let i = 0; i < data.length; i += CHUNK) {
    const res = await prisma.bar.createMany({ data: data.slice(i, i + CHUNK), skipDuplicates: true });
    inserted += res.count;
  }
  return NextResponse.json({ ok: true, symbol, root, received: rows.length, inserted });
}

// GET /api/bars?stats=1                      → přehled (kolik barů, jaké symboly) pro ověření
// GET /api/bars?root=6A&from=ISO&to=ISO      → bary pro graf (auth: přihlášení)
export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;

  if (sp.get("stats")) {
    const total = await prisma.bar.count();
    const roots = await prisma.bar.groupBy({ by: ["root"], _count: { _all: true }, _min: { time: true }, _max: { time: true } });
    return NextResponse.json({
      total,
      roots: roots.map((r) => ({ root: r.root, bars: r._count._all, from: r._min.time, to: r._max.time })).sort((a, b) => a.root.localeCompare(b.root)),
    });
  }

  const root = (sp.get("root") || "").toUpperCase();
  const from = sp.get("from") ? new Date(sp.get("from")) : null;
  const to = sp.get("to") ? new Date(sp.get("to")) : null;
  if (!root || !from || !to || isNaN(from) || isNaN(to)) {
    return NextResponse.json({ error: "need root, from, to (ISO)" }, { status: 400 });
  }

  const bars = await prisma.bar.findMany({
    where: { root, time: { gte: from, lte: to } },
    select: { symbol: true, time: true, open: true, high: true, low: true, close: true, volume: true },
    orderBy: { time: "asc" },
    take: 5000,
  });
  return NextResponse.json({ root, count: bars.length, bars });
}
