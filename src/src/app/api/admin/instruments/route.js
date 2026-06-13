import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return session && session.user?.role === "admin" ? session : null;
}

// Vytvoření / úprava instrumentu (podle symbolu)
export async function POST(req) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const symbol = String(body.symbol || "").trim().toUpperCase();
  const tickSize = Number(body.tickSize);
  const tickValue = Number(body.tickValue);

  if (!symbol) return NextResponse.json({ error: "Chybí symbol." }, { status: 400 });
  if (!isFinite(tickSize) || tickSize <= 0) return NextResponse.json({ error: "Tick size musí být kladné číslo." }, { status: 400 });
  if (!isFinite(tickValue) || tickValue <= 0) return NextResponse.json({ error: "Tick value musí být kladné číslo." }, { status: 400 });

  const data = {
    name: body.name ? String(body.name) : null,
    tickSize, tickValue,
    currency: body.currency ? String(body.currency).slice(0, 4) : "USD",
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
  };

  const saved = await prisma.instrument.upsert({
    where: { symbol },
    update: data,
    create: { symbol, ...data },
  });
  return NextResponse.json({ ok: true, instrument: saved });
}

// Smazání instrumentu
export async function DELETE(req) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const symbol = new URL(req.url).searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "missing symbol" }, { status: 400 });

  await prisma.instrument.deleteMany({ where: { symbol: symbol.toUpperCase() } });
  return NextResponse.json({ ok: true });
}
