export function buildId(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,128}$/.test(value) ? value : null;
}

export function buildRevision(value: unknown): string | null {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value) ? value.toLowerCase() : null;
}

export function pageBuildId(serialized: string | null): string | null {
  try {
    const data: unknown = JSON.parse(serialized ?? "null");
    return typeof data === "object" && data !== null && "buildId" in data ? buildId(data.buildId) : null;
  } catch {
    return null;
  }
}

export type BuildCheck =
  | { status: "idle" }
  | { status: "verified"; buildId: string; revision: string | null; version: string; checkedAt: string }
  | { status: "unavailable"; reason: "offline" | "network" | "timeout" | "http" | "invalid-response" | "unverified-freshness" | "unsupported" };

export type VerifiedBuild = Extract<BuildCheck, { status: "verified" }>;

export function validateBuildResponse(value: unknown, nonce: string, checkedAt: string): BuildCheck {
  if (typeof value !== "object" || value === null) return { status: "unavailable", reason: "invalid-response" };
  if (!("nonce" in value) || value.nonce !== nonce) return { status: "unavailable", reason: "unverified-freshness" };
  const id = "buildId" in value ? buildId(value.buildId) : null;
  const version = "version" in value && typeof value.version === "string" && /^\d+\.\d+\.\d+[-+.\w]*$/.test(value.version) && value.version.length < 64 ? value.version : null;
  if (!id || !version) return { status: "unavailable", reason: "invalid-response" };
  return { status: "verified", buildId: id, version, revision: "revision" in value ? buildRevision(value.revision) : null, checkedAt };
}

export function deploymentStatus(client: string | null, check: BuildCheck) {
  if (!client || check.status !== "verified") return "unknown";
  if (client === "development" || check.buildId === "development") return "development";
  return client === check.buildId ? "same" : "different";
}

export async function checkServerBuild(): Promise<BuildCheck> {
  let nonce: string;
  try {
    nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
  } catch {
    return { status: "unavailable", reason: "unsupported" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    // POST bypasses the GET-only API caches in already-installed older workers.
    const response = await fetch("/api/build-info", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce }), signal: controller.signal,
    });
    if (!response.ok) return { status: "unavailable", reason: "http" };
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      return { status: "unavailable", reason: controller.signal.aborted ? "timeout" : "invalid-response" };
    }
    return validateBuildResponse(value, nonce, new Date().toISOString());
  } catch {
    return { status: "unavailable", reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timeout);
  }
}
