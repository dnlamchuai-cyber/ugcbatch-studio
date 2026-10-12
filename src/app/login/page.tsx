"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { loadAuthConfig, signIn } from "@/lib/auth/session";

export default function LoginPage() {
  const t = useT("auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signUp, setSignUp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mock, setMock] = useState(false);
  useEffect(() => { loadAuthConfig().then((c) => setMock(c.mode === "mock")); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await signIn(email, password, signUp); router.replace("/"); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 space-y-4">
          <h1 className="text-xl font-semibold">{signUp ? t("signUpTitle") : t("signInTitle")}</h1>
          {mock && <p className="text-xs text-amber-500" data-testid="mock-notice">{t("mockNotice")}</p>}
          <form onSubmit={submit} className="space-y-3">
            <Input type="email" placeholder={t("email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input type="password" placeholder={t("password")} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{signUp ? t("signUp") : t("signIn")}</Button>
          </form>
          <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setSignUp(!signUp)}>
            {signUp ? t("haveAccount") : t("noAccount")}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
