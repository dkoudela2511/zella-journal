import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const instruments = await prisma.instrument.findMany({
    orderBy: [{ sortOrder: "asc" }, { symbol: "asc" }],
  });
  return NextResponse.json({ instruments });
}
