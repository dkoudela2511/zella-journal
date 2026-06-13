import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw = String(body.code || "").trim().toUpperCase();
  if (!raw) return NextResponse.json({ error: "Zadej kód." }, { status: 400 });

  const code = await prisma.inviteCode.findUnique({ where: { code: raw } });
  if (!code) return NextResponse.json({ error: "Kód neexistuje." }, { status: 404 });
  if (code.usedById) return NextResponse.json({ error: "Kód už byl použitý." }, { status: 409 });
  if (code.mentorId === session.user.id) return NextResponse.json({ error: "Nemůžeš použít vlastní kód." }, { status: 400 });

  await prisma.$transaction([
    prisma.user.update({ where: { id: session.user.id }, data: { mentorId: code.mentorId } }),
    prisma.inviteCode.update({ where: { code: raw }, data: { usedById: session.user.id, usedAt: new Date() } }),
  ]);

  const mentor = await prisma.user.findUnique({ where: { id: code.mentorId }, select: { name: true, email: true } });
  return NextResponse.json({ ok: true, mentorName: mentor?.name || mentor?.email || "Mentor" });
}
