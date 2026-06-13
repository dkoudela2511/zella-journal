import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import InstrumentsAdmin from "@/components/InstrumentsAdmin";

export default async function InstrumentsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user?.role !== "admin") redirect("/app");
  return <InstrumentsAdmin />;
}
