"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/hooks/use-login";
import { attemptSilentRefresh } from "@/lib/client-session";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const login = useLogin();
  const router = useRouter();

  // Middleware only reaches this page when the access token is missing or
  // expired — the 14-day refresh token may still be good, so try to revive
  // the session silently before asking for credentials again. The refresh
  // cookie is scoped to this exact path (Path=/api/admin/auth), which is
  // exactly why middleware itself can't do this check — see middleware.ts.
  useEffect(() => {
    let cancelled = false;
    attemptSilentRefresh().then((revived) => {
      if (cancelled) return;
      if (revived) {
        router.replace("/");
        router.refresh();
        return;
      }
      setIsCheckingSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="glass-panel w-full max-w-sm border-none">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Myunivokai Admin</CardTitle>
          <CardDescription>Staff sign-in</CardDescription>
        </CardHeader>
        <CardContent>
          {isCheckingSession ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Checking your session…</p>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              {login.isError ? <p className="text-sm text-destructive">{login.error.message}</p> : null}
              <Button type="submit" className="mt-2" disabled={login.isPending}>
                {login.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
