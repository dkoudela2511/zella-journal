import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import JournalLoader from "@/components/JournalLoader";

export default async function AppPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  return <JournalLoader />;
}
