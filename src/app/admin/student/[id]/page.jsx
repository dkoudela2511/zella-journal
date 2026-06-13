import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import MentorView from "@/components/MentorView";

export default async function StudentPage({ params }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user?.role !== "admin") redirect("/app");
  return <MentorView userId={params.id} />;
}
