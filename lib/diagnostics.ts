export const diagnosticOperations = [
  "read", "thread", "account", "subscription", "multi",
  "save", "hide", "vote", "comment", "delete", "other",
] as const;
export type DiagnosticOperation = typeof diagnosticOperations[number];
type HttpOutcome = "response" | "network-error" | "cancelled";
type ErrorScope = "application" | "feed" | "post-body" | "window" | "other";
type ResourceKind = "app-code" | "image" | "video" | "embed" | "other";
type ErrorName = "TypeError" | "ReferenceError" | "SyntaxError" | "RangeError" | "ChunkLoadError" | "Error" | "other";
type EventData =
  | { kind: "request"; operation: DiagnosticOperation; method: string; status: number | null; outcome: HttpOutcome; durationMs: number | null }
  | { kind: "runtime"; scope: ErrorScope; name: ErrorName }
  | { kind: "resource"; resource: ResourceKind; mediaError: number | null }
  | { kind: "gesture-cancel" };
export type DiagnosticEvent = EventData & { ageMs: number };

const numberOrNull = (value: unknown, min = 0, max = 3_600_000) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value * 100) / 100
    : null;

export function createDiagnosticBuffer(now = () => Date.now()) {
  let events: (EventData & { at: number })[] = [];
  let failures: number[] = [];
  const recordingFailed = () => { failures = [...failures, now()].slice(-40); };
  const ambient = (event: EventData) =>
    (event.kind === "resource" && event.resource !== "app-code") ||
    (event.kind === "runtime" && event.scope === "window" && event.name !== "ChunkLoadError");
  const add = (event: EventData) => {
    events.push({ ...event, at: now() });
    if (events.filter(ambient).length > 10) {
      events.splice(events.findIndex(ambient), 1);
    }
    events = events.slice(-40);
  };
  return {
    request(input: { operation: unknown; method: unknown; status: unknown; outcome: unknown; durationMs: unknown }) {
      const status = numberOrNull(input.status, 0, 599);
      const outcome = input.outcome === "network-error" ? "network-error" : input.outcome === "cancelled" ? "cancelled" : "response";
      if (outcome === "cancelled" || (outcome === "response" && status !== null && status < 400)) return;
      add({
        kind: "request",
        operation: diagnosticOperations.find((value) => value === input.operation) ?? "other",
        method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].find((value) => value === input.method) ?? "OTHER",
        status, outcome,
        durationMs: numberOrNull(input.durationMs),
      });
    },
    runtime(scope: unknown, error: unknown) {
      const scopes: ErrorScope[] = ["application", "feed", "post-body", "window"];
      const names: ErrorName[] = ["TypeError", "ReferenceError", "SyntaxError", "RangeError", "ChunkLoadError", "Error"];
      let name: unknown;
      try {
        name = typeof error === "object" && error !== null && "name" in error ? error.name : undefined;
      } catch {
        recordingFailed();
      }
      add({ kind: "runtime", scope: scopes.find((value) => value === scope) ?? "other", name: names.find((value) => value === name) ?? "other" });
    },
    resource(resource: unknown, mediaError?: unknown) {
      const kinds: ResourceKind[] = ["app-code", "image", "video", "embed"];
      const kind = kinds.find((value) => value === resource) ?? "other";
      const code = numberOrNull(mediaError, 1, 4);
      add({ kind: "resource", resource: kind, mediaError: code });
    },
    gestureCancelled() { add({ kind: "gesture-cancel" }); },
    recordingFailed,
    snapshot(): DiagnosticEvent[] {
      const time = now();
      events = events.filter((event) => time - event.at <= 300_000);
      return events.map(({ at, ...event }) => ({ ...event, ageMs: Math.max(0, Math.round(time - at)) }));
    },
    get failures() {
      failures = failures.filter((at) => now() - at <= 300_000);
      return failures.length;
    },
  };
}

export async function observeRequest<T extends { status: number }>(
  send: () => Promise<T>,
  record: (result: { status: number | null; outcome: HttpOutcome; durationMs: number }) => void,
  classifyError: (error: unknown) => { status: number | null; cancelled: boolean },
  recordingFailed: () => void,
  now = () => Date.now()
): Promise<T> {
  const started = now();
  const safelyRecord = (read: () => { status: number | null; outcome: HttpOutcome }) => {
    try {
      record({ ...read(), durationMs: Math.max(0, now() - started) });
    } catch {
      // Diagnostic bookkeeping must not replace the request's result or error.
      recordingFailed();
    }
  };
  let response: T;
  try {
    response = await send();
  } catch (error) {
    safelyRecord(() => {
      const failure = classifyError(error);
      return { status: failure.status, outcome: failure.cancelled ? "cancelled" : failure.status === null ? "network-error" : "response" };
    });
    throw error;
  }
  safelyRecord(() => ({ status: response.status, outcome: "response" }));
  return response;
}

export function inspectFeedCache(values: unknown[]) {
  let loaded = 0;
  let malformed = 0;
  let unreadable = 0;
  for (const value of values) {
    if (value === undefined) continue;
    loaded++;
    try {
      if (
        typeof value !== "object" || value === null || Array.isArray(value) ||
        !("pages" in value) || !Array.isArray(value.pages) ||
        value.pages.some((page) => typeof page !== "object" || page === null || !Array.isArray(page.filtered))
      ) malformed++;
    } catch {
      unreadable++;
    }
  }
  return { loaded, malformed, unreadable };
}

export function parseTranslation(transform: unknown): { x: number; y: number } | null {
  if (transform === "none") return { x: 0, y: 0 };
  if (typeof transform !== "string") return null;
  const match = transform.match(/^matrix(3d)?\(([^)]+)\)$/);
  if (!match) return null;
  const values = match[2].split(",").map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (match[1] && values.length === 16) return { x: values[12], y: values[13] };
  if (!match[1] && values.length === 6) return { x: values[4], y: values[5] };
  return null;
}

export function buildId(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,128}$/.test(value) ? value : null;
}
export function buildRevision(value: unknown): string | null {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value) ? value.toLowerCase() : null;
}

export type BuildCheck =
  | { status: "checking" }
  | { status: "verified"; buildId: string; revision: string | null; version: string; checkedAt: string }
  | { status: "unavailable"; reason: "network" | "timeout" | "http" | "invalid-response" | "unverified-freshness" | "unsupported"; httpStatus?: number };

export function validateBuildResponse(value: unknown, nonce: string, checkedAt: string): BuildCheck {
  if (typeof value !== "object" || value === null) return { status: "unavailable", reason: "invalid-response" };
  if (!("nonce" in value) || value.nonce !== nonce) return { status: "unavailable", reason: "unverified-freshness" };
  const id = "buildId" in value ? buildId(value.buildId) : null;
  const version = "version" in value && typeof value.version === "string" && /^\d+\.\d+\.\d+[-+.\w]*$/.test(value.version) && value.version.length < 64 ? value.version : null;
  if (!id || !version) return { status: "unavailable", reason: "invalid-response" };
  return { status: "verified", buildId: id, version, revision: "revision" in value ? buildRevision(value.revision) : null, checkedAt };
}

export function browserPlatform(ua: string, platform: string, maxTouchPoints: number) {
  if (/iPhone|iPad|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && platform === "MacIntel" && maxTouchPoints > 1)) return "iOS";
  if (/Macintosh/.test(ua)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  return "other";
}

export type WorkerCheck =
  | { status: "checking" | "unsupported" | "unavailable" | "unregistered" }
  | { status: "registered"; controlled: boolean; controllerChanged: boolean; active: string | null; waiting: boolean; installing: boolean };

export interface MotionSnapshot {
  offset: number | null;
  expected: number | null;
  quietForMs: number | null;
}
export interface LayoutSnapshot {
  available: boolean;
  htmlOverflowY: string;
  bodyOverflowY: string;
  applicationLock?: "locked" | "unlocked" | "other";
  htmlInlineOverflowY?: string;
  htmlPaddingRightPx?: number | null;
  owners: { post: number; navigation: number; peek: number; dialog: number; fullscreen: boolean };
  modalX: MotionSnapshot | null;
  railY: MotionSnapshot | null;
  activeMediaInput: boolean;
  inputTrackingStale?: boolean;
  zoom: number | null;
  renderErrors: number;
}
export interface DiagnosticSnapshot {
  capturedAt: string;
  captureSource: "pointer" | "keyboard" | "direct";
  client: { buildId: string | null; revision: string | null; version: string; view: "feed" | "post" | "settings" | "search" | "other" };
  browser: { family: string; version: string | null; platform: string; standalone: boolean; online: boolean; secure: boolean };
  viewport: { width: number; height: number; visualWidth: number | null; visualHeight: number | null; offsetTop: number | null; offsetLeft: number | null; scale: number | null };
  layout: LayoutSnapshot;
  cache: ReturnType<typeof inspectFeedCache>;
  events: DiagnosticEvent[];
  recorderFailures: number;
}
export interface DiagnosticFinding {
  code: string;
  confidence: "measured" | "possible" | "context" | "unknown";
  title: string;
  explanation: string;
  evidence: string[];
  nextStep: string;
}
export interface DiagnosticReport {
  schema: "troddit-diagnostics/v1";
  snapshot: DiagnosticSnapshot;
  build: BuildCheck;
  worker: WorkerCheck;
  findings: DiagnosticFinding[];
}

export function diagnose(snapshot: DiagnosticSnapshot, build: BuildCheck, worker: WorkerCheck): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  try {
    const layout = snapshot.layout;
    const motionChecks = [
      ["horizontal-offset", "The post viewer is displaced sideways", layout.modalX],
      ["vertical-offset", "The media slide is between its expected positions", layout.railY],
    ] as const;
    if (layout.available) {
      for (const [code, title, motion] of motionChecks) {
        if (!motion || motion.offset === null || motion.expected === null) continue;
        const difference = motion.offset - motion.expected;
        if (Math.abs(difference) <= 2) continue;
        const busy = layout.activeMediaInput || motion.quietForMs === null || motion.quietForMs < 400 ||
          layout.zoom !== 1 || (snapshot.viewport.scale !== null && Math.abs(snapshot.viewport.scale - 1) > 0.01);
        findings.push({
          code, confidence: busy ? "unknown" : "measured", title: busy ? "Movement needs a settled capture" : title,
          explanation: busy
            ? layout.inputTrackingStale
              ? "Input tracking still contains an old contact without a matching release. Age alone cannot prove that a finger is no longer held down."
              : "A gesture, zoom, recent transition, or missing timing information prevents calling this a stuck position."
            : "The viewer's transform differs from its expected resting position after movement has settled. This can leave part of the post off-screen while the viewer keeps page scrolling locked.",
          evidence: [`Actual offset: ${motion.offset}px`, `Expected offset: ${motion.expected}px`, `Difference: ${Math.round(difference)}px`, `Quiet for: ${motion.quietForMs ?? "unknown"}ms`, `Recent native cancellation: ${snapshot.events.some((event) => event.kind === "gesture-cancel")}`],
          nextStep: busy ? "Release the gesture, then tap the diagnosis control again after the view settles." : "Copy this report before closing and reopening the viewer.",
        });
      }
      const lockOwners = layout.owners.post + layout.owners.navigation + layout.owners.peek;
      const lockContexts = lockOwners + layout.owners.dialog + Number(layout.owners.fullscreen);
      const locked = [layout.htmlOverflowY, layout.bodyOverflowY].some((value) => value === "hidden" || value === "clip");
      const known = layout.htmlOverflowY !== "unknown" && layout.bodyOverflowY !== "unknown";
      if (known && ((locked && lockContexts === 0) || (!locked && lockOwners > 0))) {
        findings.push({
          code: locked ? "orphaned-scroll-lock" : "lost-scroll-lock", confidence: "measured",
          title: locked ? "A page scroll lock has no visible owner" : "An open overlay has lost its page scroll lock",
          explanation: locked
            ? "Vertical overflow is disabled, but no post viewer, navigation drawer, media peek, dialog, or fullscreen owner was present in the capture."
            : "An overlay that normally owns the page scroll lock is present, but neither the document nor body is vertically locked. Another overlay's cleanup may have released it.",
          evidence: [`Document overflow-y: ${layout.htmlOverflowY}`, `Body overflow-y: ${layout.bodyOverflowY}`, `App lock owners: ${lockOwners}`, `Other modal/fullscreen contexts: ${lockContexts - lockOwners}`, `App lock flag: ${layout.applicationLock ?? "unknown"}`, `Inline document overflow-y: ${layout.htmlInlineOverflowY ?? "unknown"}; padding-right: ${layout.htmlPaddingRightPx ?? "unknown"}px`],
          nextStep: "Copy the report before closing overlays or reloading. Do not clear saved app data.",
        });
      }
      if (layout.renderErrors > 0) findings.push({
        code: "render-fallback", confidence: "measured", title: "A rendering error view is active",
        explanation: "Troddit has replaced part of the interface with an error fallback. This is an application rendering failure, not proof of a Safari paint bug.",
        evidence: [`Visible error fallbacks: ${layout.renderErrors}`],
        nextStep: "Include the recent failure details and build identity when reporting this.",
      });
    }
    if (snapshot.cache.malformed > 0) findings.push({
      code: "feed-cache-shape", confidence: "measured", title: "Feed cache data has an unexpected structure",
      explanation: "A loaded feed entry is not in the pages/filtered structure the renderer expects. This can break rendering even when the network is working.",
      evidence: [`Loaded feed entries: ${snapshot.cache.loaded}`, `Malformed entries: ${snapshot.cache.malformed}`],
      nextStep: "Copy the report before reloading; a failed action or cache update may explain how this happened.",
    });
    const runtimeFailure = [...snapshot.events].reverse().find((event) => event.kind === "runtime" && event.scope !== "window" && event.scope !== "other");
    if (runtimeFailure?.kind === "runtime" && runtimeFailure.name !== "ChunkLoadError") findings.push({
      code: "recent-runtime-error", confidence: "possible", title: "A JavaScript failure was recently recorded",
      explanation: "This may be related to the problem, but the event alone does not establish the cause. Exception text is intentionally excluded because it can contain private data.",
      evidence: [`Scope: ${runtimeFailure.scope}`, `Error type: ${runtimeFailure.name}`, `Observed ${Math.round(runtimeFailure.ageMs / 1000)}s before capture`],
      nextStep: "Include this report and a screenshot so the failure can be correlated with the deployed code.",
    });
    const mediaFailure = [...snapshot.events].reverse().find((event) => event.kind === "resource" && event.resource !== "app-code");
    if (mediaFailure?.kind === "resource") findings.push({
      code: "recent-media-error", confidence: "possible",
      title: mediaFailure.mediaError === 3 || mediaFailure.mediaError === 4 ? "The browser could not decode or support a media source" : "A media resource recently failed",
      explanation: "The browser or provider reported a loading failure. This is distinct from a displaced viewer; the original source link can help distinguish unavailable content from browser playback support.",
      evidence: [`Resource: ${mediaFailure.resource}`, `Media error code: ${mediaFailure.mediaError ?? "not provided"}`, `Observed ${Math.round(mediaFailure.ageMs / 1000)}s before capture`],
      nextStep: "Try the original source link and include this report if playback still fails.",
    });
    const failedRequests = snapshot.events.filter((event) => event.kind === "request" && event.outcome !== "cancelled" && (event.outcome === "network-error" || (event.status !== null && event.status >= 400)));
    for (const event of failedRequests.slice(-3)) {
      if (event.kind !== "request") continue;
      const reason = event.status === 429 ? "Reddit rate limiting" : event.status === 401 || event.status === 403 ? "An authentication or permission response" : event.status !== null && event.status >= 500 ? "A server or proxy failure" : event.outcome === "network-error" ? "A request failed without an HTTP response" : "A request was rejected";
      findings.push({
        code: "recent-request-failure", confidence: "possible", title: reason,
        explanation: "This recent request failure may explain missing content or an unsuccessful action. It is not proof that the current view is still blocked.",
        evidence: [`Operation: ${event.operation}`, `Method: ${event.method}`, `HTTP status: ${event.status ?? "unavailable"}`, `Observed ${Math.round(event.ageMs / 1000)}s before capture`],
        nextStep: event.status === 429 ? "Allow the rate-limit countdown to finish before retrying." : "Check the connection or sign-in state, and preserve this report if it repeats.",
      });
    }
    const chunksFailed = snapshot.events.some((event) => (event.kind === "runtime" && event.name === "ChunkLoadError") || (event.kind === "resource" && event.resource === "app-code"));
    const differentBuild = build.status === "verified" && snapshot.client.buildId !== null && snapshot.client.buildId !== build.buildId;
    if (chunksFailed) findings.push({
      code: "app-code-load", confidence: "possible", title: "Application code recently failed to load",
      explanation: differentBuild
        ? "The open page and server have different build IDs, and an application-code loading failure was recorded. A deployment/cache mismatch is a plausible contributor, not a proven service-worker fault."
        : "An application-code loading failure was recorded. Network, caching, or deployment problems can cause this; the capture does not identify which one.",
      evidence: [differentBuild ? "Different page/server build IDs verified" : "No verified build mismatch", "Recent application-code failure"],
      nextStep: "Copy the report before a deliberate reload.",
    });
    if (differentBuild && build.status === "verified") findings.push({
      code: "different-build", confidence: "context", title: "The server is serving a different build",
      explanation: "This identifies a deployment difference, not its direction or the cause of a display problem.",
      evidence: [`Page build: ${snapshot.client.buildId}`, `Server build: ${build.buildId}`],
      nextStep: "After preserving the report, reload deliberately to load the currently served app.",
    });
    if (worker.status === "registered" && worker.waiting) findings.push({
      code: "worker-waiting", confidence: "context", title: "A service-worker update is waiting",
      explanation: "A downloaded worker has not activated. The absence of a waiting worker does not mean this page is current.",
      evidence: ["registration.waiting is present"], nextStep: "Preserve the report before reloading or closing other app windows.",
    });
    if (build.status === "unavailable") findings.push({
      code: "build-unavailable", confidence: "unknown", title: "The server build could not be verified",
      explanation: build.reason === "unverified-freshness"
        ? "The response did not echo this request's fresh challenge, so it cannot be trusted for version comparison."
        : "The build check failed or returned unusable metadata. This must not be interpreted as 'no update'.",
      evidence: [`Reason: ${build.reason}`, ...(build.httpStatus ? [`HTTP status: ${build.httpStatus}`] : [])],
      nextStep: "Keep the captured page evidence; retry the build check when connectivity or the server is available.",
    });
    if (snapshot.client.buildId === null) findings.push({
      code: "client-build-unavailable", confidence: "unknown", title: "The loaded page's build identity is unavailable",
      explanation: "Without a page build ID, a verified server response still cannot establish whether the open page is current.",
      evidence: ["Page build ID unavailable"], nextStep: "Preserve this capture; a reload may restore the page metadata.",
    });
    if (!layout.available || snapshot.cache.unreadable > 0 || snapshot.recorderFailures > 0) findings.push({
      code: "partial-capture", confidence: "unknown", title: "Some diagnostic evidence is unavailable",
      explanation: "The diagnosis is incomplete because a collector could not inspect or record part of the state.",
      evidence: [`Layout available: ${layout.available}`, `Unreadable cache entries: ${snapshot.cache.unreadable}`, `Recorder failures: ${snapshot.recorderFailures}`],
      nextStep: "Include a screenshot and capture again if possible.",
    });
    if (!findings.some((finding) => finding.confidence === "measured")) findings.unshift({
      code: "no-cause-identified", confidence: "unknown", title: "No cause identified in this capture",
      explanation: "No current invariant violation was measured. Recent failures and deployment differences are clues, not proof of the cause; normal DOM measurements do not rule out an intermittent or paint-only iPhone Safari problem.",
      evidence: ["Historical failures, viewport and worker details do not establish the current cause"],
      nextStep: "Capture while the problem is visible and include a screenshot with the report.",
    });
    return findings;
  } catch {
    return [{
      code: "analysis-unavailable", confidence: "unknown", title: "The captured state could not be analyzed",
      explanation: "Missing or unreadable values prevented a reliable diagnosis. No healthy-state conclusion was made.",
      evidence: [], nextStep: "Capture again and include a screenshot if the problem persists.",
    }];
  }
}
