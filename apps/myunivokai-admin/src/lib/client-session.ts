// Client-only: calling fetch("/api/admin/auth/refresh") FROM THE BROWSER
// targets that exact path, so the browser correctly attaches the refresh
// cookie (Path=/api/admin/auth) — unlike middleware.ts, which handles
// requests to every OTHER path and structurally never sees that cookie. This
// is what revives a session after the 10-minute access token expires,
// without asking for credentials again as long as the 14-day refresh token
// is still good. See the two call sites: the login page (revive-on-mount)
// and useSessionKeepAlive (periodic, while the dashboard stays open).
export async function attemptSilentRefresh(): Promise<boolean> {
  try {
    const response = await fetch("/api/admin/auth/refresh", { method: "POST" });
    return response.ok;
  } catch {
    return false;
  }
}
