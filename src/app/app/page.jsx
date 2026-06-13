import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import JournalLoader from "@/components/JournalLoader";

export default async function AppPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const isAdmin = session.user?.role === "admin";

  let enrolled = false;
  let mentorName = null;
  if (session.user?.id) {
    const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { mentorId: true } });
    if (me?.mentorId) {
      enrolled = true;
      const m = await prisma.user.findUnique({ where: { id: me.mentorId }, select: { name: true, email: true } });
      mentorName = m?.name || m?.email || "Mentor";
    }
  }

  return <JournalLoader isAdmin={isAdmin} enrolled={enrolled} mentorName={mentorName} />;
}
