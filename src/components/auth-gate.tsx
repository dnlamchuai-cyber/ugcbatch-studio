"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSession } from "@/lib/auth/session";

/** Redirects to /login when there is no session (Supabase or mock local). */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const [ready, setReady] = useState(isLogin);
  useEffect(() => {
    if (isLogin) { setReady(true); return; }
    let alive = true;
    getSession().then((s) => {
      if (!alive) return;
      if (!s) router.replace("/login"); else setReady(true);
    });
    return () => { alive = false; };
  }, [isLogin, router]);
  if (!ready) return null;
  return <>{children}</>;
}
