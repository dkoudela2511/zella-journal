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
    mentorPlans: data["tz:mentor:plans:v1"] || {},
    instruments,
  });
}

// POST: mentor zapíše komentář k dennímu plánu studenta
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const { userId, dayKey, comment } = body;
  if (!userId || !dayKey) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  const student = await prisma.user.findUnique({ where: { id: userId }, select: { mentorId: true } });
  if (!student || student.mentorId !== session.user.id) {
    return NextResponse.json({ error: "not your student" }, { status: 403 });
  }

  const key = "tz:mentor:plans:v1";
  const row = await prisma.store.findUnique({ where: { userId_key: { userId, key } } });
  let plans = {};
  if (row) { try { plans = JSON.parse(row.value) || {}; } catch {} }
  const day = plans[dayKey] || {};
  day.mentorComment = String(comment || "").slice(0, 2000);
  day.mentorAt = new Date().toISOString();
  plans[dayKey] = day;

  await prisma.store.upsert({
    where: { userId_key: { userId, key } },
    update: { value: JSON.stringify(plans) },
    create: { userId, key, value: JSON.stringify(plans) },
  });

  return NextResponse.json({ ok: true, mentorAt: day.mentorAt });
}
