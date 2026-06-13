import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "missing userId" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, mentorId: true, createdAt: true },
  });
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  const keys = ["tz:trades:v1", "tz:accounts:v1", "tz:frameworks:v1", "tz:mentor:trades:v1", "tz:mentor:plans:v1"];
  const rows = await prisma.store.findMany({
    where: { userId, key: { in: keys } },
    select: { key: true, value: true },
  });
  const data = {};
  rows.forEach((r) => { try { data[r.key] = JSON.parse(r.value); } catch { data[r.key] = null; } });

  const instruments = await prisma.instrument.findMany();

  return NextResponse.json({
    user,
    trades: data["tz:trades:v1"] || [],
    accounts: data["tz:accounts:v1"] || [],
    frameworks: data["tz:frameworks:v1"] || [],
    mentorTrades: data["tz:mentor:trades:v1"] || [],
    mentorPlans: Array.isArray(data["tz:mentor:plans:v1"]) ? data["tz:mentor:plans:v1"] : [],
    instruments,
  });
}

// POST: mentor zapíše komentář k obchodnímu plánu studenta (podle planId)
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const { userId, planId, comment } = body;
  if (!userId || !planId) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  const student = await prisma.user.findUnique({ where: { id: userId }, select: { mentorId: true } });
  if (!student || student.mentorId !== session.user.id) {
    return NextResponse.json({ error: "not your student" }, { status: 403 });
  }

  const key = "tz:mentor:plans:v1";
  const row = await prisma.store.findUnique({ where: { userId_key: { userId, key } } });
  let plans = [];
  if (row) { try { const v = JSON.parse(row.value); plans = Array.isArray(v) ? v : []; } catch {} }
  const at = new Date().toISOString();
  let found = false;
  plans = plans.map((p) => {
    if (p && p.id === planId) { found = true; return { ...p, mentorComment: String(comment || "").slice(0, 2000), mentorAt: at }; }
    return p;
  });
  if (!found) return NextResponse.json({ error: "plan not found" }, { status: 404 });

  await prisma.store.upsert({
    where: { userId_key: { userId, key } },
    update: { value: JSON.stringify(plans) },
    create: { userId, key, value: JSON.stringify(plans) },
  });

  return NextResponse.json({ ok: true, mentorAt: at });
}
