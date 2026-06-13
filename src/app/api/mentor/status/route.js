import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TRUST_KEY = "tz:mentor:trust:v1";

export async function GET() {
  const session = await getServerSession(authOptions);
  const uid = session?.user?.id;
  if (!uid) return NextResponse.json({ trusted: false });

  const me = await prisma.user.findUnique({ where: { id: uid }, select: { mentorId: true } });
  if (!me?.mentorId) return NextResponse.json({ trusted: false });

  const row = await prisma.store.findUnique({
    where: { userId_key: { userId: me.mentorId, key: TRUST_KEY } },
  });
  let trusted = false;
  if (row) {
    try { const m = JSON.parse(row.value) || {}; trusted = !!m[uid]; } catch {}
  }
  return NextResponse.json({ trusted });
}
