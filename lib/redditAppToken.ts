// Server-only helper. Mints and caches a Reddit "application-only" (userless)
// OAuth token via the client_credentials grant so logged-out / anonymous
// requests can be served from oauth.reddit.com instead of the public
// www.reddit.com/*.json endpoints (which Reddit now blocks with 403).
//
// Do NOT import this from client/browser code — it reads CLIENT_SECRET.

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

export function redditUserAgent(): string {
  return (
    process.env.REDDIT_USER_AGENT ||
    `web:troddit:v0.21.0 (self-hosted troddit client)`
  );
}

async function mint(): Promise<string | null> {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": redditUserAgent(),
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (!data?.access_token) return null;

  const ttl = typeof data.expires_in === "number" ? data.expires_in : 3600;
  cached = {
    token: data.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + ttl,
  };
  return cached.token;
}

// Returns a valid app-only token, minting + caching as needed. A single
// in-flight request is shared to avoid a refresh stampede across concurrent
// proxy calls. Returns null when no credentials are configured or minting fails.
export async function getAppOnlyToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > now) return cached.token;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      return await mint();
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function invalidateAppOnlyToken(): void {
  cached = null;
}
