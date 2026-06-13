import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { summarize, instrumentMap } from "@/lib/stats";

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

export async function GET() {
  const me = await requireAdmin();
  if (!me) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const codes = await prisma.inviteCode.findMany({
    where: { mentorId: me.id },
    orderBy: { createdAt: "desc" },
  });
  // doplníme jména studentů, kteří kód použili
  const usedIds = codes.map((c) => c.usedById).filter(Boolean);
  const students = await prisma.user.findMany({
    where: { mentorId: me.id },
    select: { id: true, email: true, name: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const usersById = {};
  [...students].forEach((u) => (usersById[u.id] = u));
  if (usedIds.length) {
    const extra = await prisma.user.findMany({ where: { id: { in: usedIds } }, select: { id: true, name: true, email: true } });
    extra.forEach((u) => (usersById[u.id] = usersById[u.id] || u));
  }

  // souhrn dozorovaných obchodů u každého studenta
  const sids = students.map((s) => s.id);
  const mtRows = sids.length
    ? await prisma.store.findMany({ where: { userId: { in: sids }, key: "tz:mentor:trades:v1" }, select: { userId: true, value: true } })
    : [];
  const mpRows = sids.length
    ? await prisma.store.findMany({ where: { userId: { in: sids }, key: "tz:mentor:plans:v1" }, select: { userId: true, value: true } })
    : [];
  const tradesByUser = {}; mtRows.forEach((r) => (tradesByUser[r.userId] = r.value));
  const plansByUser = {}; mpRows.forEach((r) => (plansByUser[r.userId] = r.value));

  const instruments = await prisma.instrument.findMany();
  const instMap = instrumentMap(instruments);

  const studentList = students.map((u) => {
    let trades = []; try { trades = JSON.parse(tradesByUser[u.id] || "[]"); } catch {}
    let plans = {}; try { plans = JSON.parse(plansByUser[u.id] || "{}"); } catch {}
    const s = summarize(trades, instMap);
    return {
      id: u.id, email: u.email, name: u.name, createdAt: u.createdAt,
      tradeCount: s.tradeCount, netPnl: s.netPnl, winRate: s.winRate,
      planCount: Object.keys(plans || {}).length,
    };
  });

  const codeList = codes.map((c) => ({
    code: c.code, note: c.note, createdAt: c.createdAt,
    used: !!c.usedById,
    usedByName: c.usedById ? (usersById[c.usedById]?.name || usersById[c.usedById]?.email || "—") : null,
  }));

  return NextResponse.json({ codes: codeList, students: studentList });
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

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
