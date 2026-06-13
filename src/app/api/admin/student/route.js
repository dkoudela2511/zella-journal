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
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  const keys = ["tz:trades:v1", "tz:accounts:v1", "tz:frameworks:v1"];
  const rows = await prisma.store.findMany({
    where: { userId, key: { in: keys } },
    select: { key: true, value: true },
  });
  const data = {};
  rows.forEach((r) => { try { data[r.key] = JSON.parse(r.value); } catch { data[r.key] = null; } });

  return NextResponse.json({
    user,
    trades: data["tz:trades:v1"] || [],
    accounts: data["tz:accounts:v1"] || [],
    frameworks: data["tz:frameworks:v1"] || [],
  });
}
