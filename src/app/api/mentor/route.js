import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { summarize, instrumentMap } from "@/lib/stats";

const SEEN_KEY = "tz:mentor:seen:v1";
const TRUST_KEY = "tz:mentor:trust:v1";
const PLAYBOOKS_KEY = "tz:mentor:playbooks:v1";

function genCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s.slice(0, 4) + "-" + s.slice(4);
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") return null;
  return session.user;
}

async function getSeenMap(mentorId) {
  const row = await prisma.store.findUnique({ where: { userId_key: { userId: mentorId, key: SEEN_KEY } } });
  if (!row) return {};
  try { return JSON.parse(row.value) || {}; } catch { return {}; }
}

async function getTrustMap(mentorId) {
  const row = await prisma.store.findUnique({ where: { userId_key: { userId: mentorId, key: TRUST_KEY } } });
  if (!row) return {};
  try { return JSON.parse(row.value) || {}; } catch { return {}; }
}

async function getPlaybooks(mentorId) {
  const row = await prisma.store.findUnique({ where: { userId_key: { userId: mentorId, key: PLAYBOOKS_KEY } } });
  if (!row) return [];
  try { const v = JSON.parse(row.value); return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function GET() {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const codes = await prisma.inviteCode.findMany({ where: { mentorId: me.id }, orderBy: { createdAt: "desc" } });
  const students = await prisma.user.findMany({
    where: { mentorId: me.id },
    select: { id: true, email: true, name: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const usersById = {};
  students.forEach((u) => (usersById[u.id] = u));
  const usedIds = codes.map((c) => c.usedById).filter(Boolean);
  if (usedIds.length) {
    const extra = await prisma.user.findMany({ where: { id: { in: usedIds } }, select: { id: true, name: true, email: true } });
    extra.forEach((u) => { usersById[u.id] = usersById[u.id] || u; });
  }

  const sids = students.map((s) => s.id);
  const mtRows = sids.length
    ? await prisma.store.findMany({ where: { userId: { in: sids }, key: "tz:mentor:trades:v1" }, select: { userId: true, value: true } })
    : [];
  const mpRows = sids.length
    ? await prisma.store.findMany({ where: { userId: { in: sids }, key: "tz:mentor:plans:v1" }, select: { userId: true, value: true } })
    : [];
  const tradesByUser = {}; mtRows.forEach((r) => (tradesByUser[r.userId] = r.value));
  const plansByUser = {}; mpRows.forEach((r) => (plansByUser[r.userId] = r.value));

  const seen = await getSeenMap(me.id);
  const trust = await getTrustMap(me.id);
  const instruments = await prisma.instrument.findMany();
  const instMap = instrumentMap(instruments);

  let totalNew = 0;
  const studentList = students.map((u) => {
    let trades = []; try { trades = JSON.parse(tradesByUser[u.id] || "[]"); } catch {}
    let plans = []; try { const v = JSON.parse(plansByUser[u.id] || "[]"); plans = Array.isArray(v) ? v : []; } catch {}
    const since = seen[u.id] || "";
    const newPlans = plans.filter((p) => p && p.createdAt && p.createdAt > since).length;
    totalNew += newPlans;
    const s = summarize(trades, instMap);
    return {
      id: u.id, email: u.email, name: u.name, createdAt: u.createdAt,
      tradeCount: s.tradeCount, netPnl: s.netPnl, winRate: s.winRate,
      planCount: plans.length, newPlans, trusted: !!trust[u.id],
    };
  });

  const codeList = codes.map((c) => ({
    code: c.code, note: c.note, createdAt: c.createdAt,
    used: !!c.usedById,
    usedByName: c.usedById ? (usersById[c.usedById]?.name || usersById[c.usedById]?.email || "—") : null,
  }));

  const playbooks = await getPlaybooks(me.id);
  return NextResponse.json({ codes: codeList, students: studentList, totalNew, playbooks });
}

export async function POST(req) {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === "invite") {
    let code = genCode();
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.inviteCode.findUnique({ where: { code } });
      if (!exists) break;
      code = genCode();
    }
    await prisma.inviteCode.create({ data: { code, mentorId: me.id, note: (body.note || "").slice(0, 60) || null } });
    return NextResponse.json({ ok: true, code });
  }

  if (action === "deleteCode") {
    if (!body.code) return NextResponse.json({ error: "missing code" }, { status: 400 });
    await prisma.inviteCode.deleteMany({ where: { code: body.code, mentorId: me.id } });
    return NextResponse.json({ ok: true });
  }

  if (action === "unenroll") {
    if (!body.userId) return NextResponse.json({ error: "missing userId" }, { status: 400 });
    await prisma.user.updateMany({ where: { id: body.userId, mentorId: me.id }, data: { mentorId: null } });
    return NextResponse.json({ ok: true });
  }

  if (action === "seen") {
    if (!body.userId) return NextResponse.json({ error: "missing userId" }, { status: 400 });
    const seen = await getSeenMap(me.id);
    seen[body.userId] = new Date().toISOString();
    await prisma.store.upsert({
      where: { userId_key: { userId: me.id, key: SEEN_KEY } },
      update: { value: JSON.stringify(seen) },
      create: { userId: me.id, key: SEEN_KEY, value: JSON.stringify(seen) },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "trust") {
    if (!body.userId) return NextResponse.json({ error: "missing userId" }, { status: 400 });
    const owns = await prisma.user.findFirst({ where: { id: body.userId, mentorId: me.id }, select: { id: true } });
    if (!owns) return NextResponse.json({ error: "not your student" }, { status: 403 });
    const trust = await getTrustMap(me.id);
    if (body.trusted) trust[body.userId] = true; else delete trust[body.userId];
    await prisma.store.upsert({
      where: { userId_key: { userId: me.id, key: TRUST_KEY } },
      update: { value: JSON.stringify(trust) },
      create: { userId: me.id, key: TRUST_KEY, value: JSON.stringify(trust) },
    });
    return NextResponse.json({ ok: true, trusted: !!body.trusted });
  }

  if (action === "playbooks") {
    const list = Array.isArray(body.playbooks) ? body.playbooks : [];
    const clean = list
      .filter((p) => p && typeof p.name === "string" && p.name.trim())
      .slice(0, 30)
      .map((p) => ({
        id: String(p.id || "").slice(0, 40) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
        name: String(p.name).trim().slice(0, 60),
        description: String(p.description || "").slice(0, 500),
        color: String(p.color || "").slice(0, 16),
      }));
    await prisma.store.upsert({
      where: { userId_key: { userId: me.id, key: PLAYBOOKS_KEY } },
      update: { value: JSON.stringify(clean) },
      create: { userId: me.id, key: PLAYBOOKS_KEY, value: JSON.stringify(clean) },
    });
    return NextResponse.json({ ok: true, playbooks: clean });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
