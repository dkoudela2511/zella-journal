import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(req) {
  try {
    const { email, password, name } = await req.json();
    const mail = (email || "").toLowerCase().trim();

    if (!mail || !password) return NextResponse.json({ error: "Vyplň e-mail i heslo." }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: "Heslo musí mít aspoň 6 znaků." }, { status: 400 });

    const existing = await prisma.user.findUnique({ where: { email: mail } });
    if (existing) return NextResponse.json({ error: "Účet s tímto e-mailem už existuje." }, { status: 409 });

    const hash = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { email: mail, password: hash, name: name || null } });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Registrace se nezdařila." }, { status: 500 });
  }
}
