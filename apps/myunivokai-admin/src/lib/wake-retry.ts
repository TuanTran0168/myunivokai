// Retrying SERVICE_WAKING is the client half of the gateway's wake mechanism
// (notes/vision/service-wake-mechanism.md). The gateway answers a request for
// a sleeping service immediately, starts it in the background, and tells the
// caller when to come back — it deliberately does not hold the connection
// open for a cold start.
//
// This retry lives in the browser and not in the BFF route handlers on
// purpose. A server-side retry would hold a Next.js route handler open for the
// whole cold start, which is the same mistake the gateway is avoiding, and
// route handlers have their own execution limits on a serverless host.
//
// It is retried for every method, not only GET. SERVICE_WAKING has exactly one
// cause — the broker reporting that no subscriber existed — so the request
// provably never reached a service and a repeat cannot apply an action twice.

const SERVICE_WAKING_ERROR_CODE = "SERVICE_WAKING";
// Six attempts roughly ten seconds apart covers a container cold start with
// margin, without leaving a user staring at a spinner forever if the service
// never comes back.
const MAXIMUM_RETRIES = 6;
const DEFAULT_RETRY_MILLISECONDS = 10_000;

export type WakeProgressHandler = (attempt: number) => void;

function retryDelayMilliseconds(response: Response): number {
  const retryAfterSeconds = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return DEFAULT_RETRY_MILLISECONDS;
}

// The response body has to be read to tell the two 503s apart: the status
// alone also covers SERVICE_UNAVAILABLE, which means a real fault that
// retrying will not fix, and GATEWAY_UNREACHABLE from the BFF relay itself.
async function isServiceWaking(response: Response): Promise<boolean> {
  if (response.status !== 503) {
    return false;
  }
  try {
    const payload = (await response.clone().json()) as { error?: { code?: string } };
    return payload?.error?.code === SERVICE_WAKING_ERROR_CODE;
  } catch {
    return false;
  }
}

function waitFor(delayMilliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
}

/**
 * fetchWithWakeRetry behaves exactly like fetch, except that a SERVICE_WAKING
 * response is waited out rather than surfaced. onWaking fires before each
 * wait so a screen can explain the delay instead of appearing to hang.
 */
export async function fetchWithWakeRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  onWaking?: WakeProgressHandler
): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(input, init);
    if (attempt > MAXIMUM_RETRIES || !(await isServiceWaking(response))) {
      return response;
    }
    onWaking?.(attempt);
    await waitFor(retryDelayMilliseconds(response));
  }
}
