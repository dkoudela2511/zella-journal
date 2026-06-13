"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

const Journal = dynamic(() => import("./Journal"), {
  ssr: false,
  loading: () => <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#6B7280" }}>Načítám deník…</div>,
});

export default function JournalLoader() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  return (
    <>
      <Journal />
      <div style={{ position: "fixed", bottom: 16, right: 18, zIndex: 60, display: "flex", gap: 8 }}>
        {isAdmin && (
          <Link
            href="/admin"
            style={{
              background: "#7C5CFC", border: "1px solid #7C5CFC", borderRadius: 10,
              padding: "8px 14px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 600,
              color: "#fff", cursor: "pointer", boxShadow: "0 4px 14px rgba(124,92,252,0.3)", textDecoration: "none",
            }}
          >
            Mentor panel
          </Link>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Odhlásit se"
          style={{
            background: "#fff", border: "1px solid #E8EAF1", borderRadius: 10,
            padding: "8px 14px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 600,
            color: "#6B7280", cursor: "pointer", boxShadow: "0 4px 14px rgba(20,25,50,0.08)",
          }}
        >
          Odhlásit
        </button>
      </div>
    </>
  );
}
