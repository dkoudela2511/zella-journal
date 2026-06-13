import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function uid() {
  const session = await getServerSession(authOptions);
  return session?.user?.id || null;
}

// GET /api/store?key=...  → { found, value }
export async function GET(req) {
  const userId = await uid();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const key = new URL(req.url).searchParams.get("key");
  if (!key) return NextResponse.json({ error: "missing key" }, { status: 400 });

  const row = await prisma.store.findUnique({ where: { userId_key: { userId, key } } });
  return NextResponse.json(row ? { found: true, value: row.value } : { found: false });
}

// POST /api/store  { op: "set"|"delete", key, value? }
export async function POST(req) {
  const userId = await uid();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { op, key, value } = body;
  if (!key) return NextResponse.json({ error: "missing key" }, { status: 400 });

  if (op === "delete") {
    await prisma.store.deleteMany({ where: { userId, key } });
    return NextResponse.json({ ok: true });
  }

  // default: set (upsert)
  await prisma.store.upsert({
    where: { userId_key: { userId, key } },
    update: { value: String(value ?? "") },
    create: { userId, key, value: String(value ?? "") },
  });
  return NextResponse.json({ ok: true });
}
