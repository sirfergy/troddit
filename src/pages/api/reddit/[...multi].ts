import type { NextApiRequest, NextApiResponse } from "next";
import {
  getAppOnlyToken,
  invalidateAppOnlyToken,
  redditUserAgent,
} from "../../../../lib/redditAppToken";

// Transparent server-side forwarder to the authenticated Reddit API.
// Everything the client used to fetch from www.reddit.com/*.json (now blocked
// with 403) is routed here instead. The proxy attaches the caller's user token
// when present, otherwise an app-only (userless) token, plus a descriptive
// User-Agent (which browsers cannot set) and Accept: application/json.

const BASE_ROUTE = "https://oauth.reddit.com";

// Disable Next's body parser so this stays a transparent proxy: bodies are
// forwarded raw rather than parsed into objects (which would be dropped).
export const config = {
  api: { bodyParser: false },
};

function readRawBody(request: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

const handler = async (request: NextApiRequest, response: NextApiResponse) => {
  const uri = request.url?.replace(/^\/api\/reddit/, "");
  const method = request.method ?? "GET";
  if (!uri) {
    response.status(400).json({ Error: "Missing data" });
    return;
  }

  // Ensure raw_json=1 so Reddit doesn't HTML-escape markdown in responses.
  const target = new URL(`${BASE_ROUTE}${uri}`);
  if (!target.searchParams.has("raw_json")) {
    target.searchParams.set("raw_json", "1");
  }

  const hasBody = method !== "GET" && method !== "HEAD";
  const rawBody = hasBody ? await readRawBody(request) : undefined;
  const body = rawBody && rawBody.length > 0 ? rawBody : undefined;

  const buildHeaders = (auth: string): Record<string, string> => {
    const headers: Record<string, string> = {
      Authorization: auth,
      "User-Agent": redditUserAgent(),
      Accept: "application/json",
    };
    const contentType = request.headers?.["content-type"];
    if (hasBody && typeof contentType === "string") {
      headers["Content-Type"] = contentType;
    }
    return headers;
  };

  const forward = (auth: string) =>
    fetch(target.toString(), { method, headers: buildHeaders(auth), body });

  try {
    const userAuth = request.headers?.["authorization"];
    let auth = userAuth;
    let usedAppToken = false;

    if (!auth) {
      const appToken = await getAppOnlyToken();
      if (!appToken) {
        response
          .status(401)
          .json({ Error: "No Reddit credentials configured" });
        return;
      }
      auth = `bearer ${appToken}`;
      usedAppToken = true;
    }

    let r = await forward(auth); console.log("FETCHED", target.toString(), buildHeaders(auth));

    // A cached app-only token may have expired; refresh once and retry.
    if (r.status === 401 && usedAppToken) {
      invalidateAppOnlyToken();
      const appToken = await getAppOnlyToken();
      if (appToken) r = await forward(`bearer ${appToken}`);
    }

    // Surface Reddit's rate-limit headers to the client for telemetry/backoff.
    ["x-ratelimit-remaining", "x-ratelimit-used", "x-ratelimit-reset"].forEach(
      (h) => {
        const v = r.headers.get(h);
        if (v !== null) response.setHeader(h, v);
      }
    );

    const text = await r.text();
    response.status(r.status);
    try {
      response.json(JSON.parse(text));
    } catch {
      response.send(text);
    }
  } catch (err) {
    response.status(502).json({ Error: "Upstream error" });
  }
  return;
};

export default handler;
