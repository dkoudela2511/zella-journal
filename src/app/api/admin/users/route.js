import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { summarize } from "@/lib/stats";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  // Načti obchody všech uživatelů jedním dotazem
  const tradeRows = await prisma.store.findMany({
    where: { key: "tz:trades:v1" },
    select: { userId: true, value: true },
  });
  const byUser = {};
  tradeRows.forEach((r) => { byUser[r.userId] = r.value; });

  const result = users.map((u) => {
    let trades = [];
    try { trades = JSON.parse(byUser[u.id] || "[]"); } catch {}
    const s = summarize(trades);
    return {
      id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt,
      tradeCount: s.tradeCount, netPnl: s.netPnl, winRate: s.winRate,
    };
  });

  return NextResponse.json({ users: result });
}
