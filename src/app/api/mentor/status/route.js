import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TRUST_KEY = "tz:mentor:trust:v1";
const PLAYBOOKS_KEY = "tz:mentor:playbooks:v1";

export async function GET() {
  const session = await getServerSession(authOptions);
  const uid = session?.user?.id;
  if (!uid) return NextResponse.json({ trusted: false, playbooks: [] });

  const me = await prisma.user.findUnique({ where: { id: uid }, select: { mentorId: true } });
  if (!me?.mentorId) return NextResponse.json({ trusted: false, playbooks: [] });

  const rows = await prisma.store.findMany({
    where: { userId: me.mentorId, key: { in: [TRUST_KEY, PLAYBOOKS_KEY] } },
  });
  let trusted = false;
  let playbooks = [];
  for (const row of rows) {
    try {
      const v = JSON.parse(row.value);
      if (row.key === TRUST_KEY) trusted = !!(v && v[uid]);
      else if (row.key === PLAYBOOKS_KEY) playbooks = Array.isArray(v) ? v : [];
    } catch {}
  }
  return NextResponse.json({ trusted, playbooks });
}
