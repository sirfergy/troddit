import axios from "axios";
import type { QueryClient } from "@tanstack/react-query";
import {
  buildId, buildRevision, createDiagnosticBuffer, inspectFeedCache,
  observeRequest, parseTranslation, validateBuildResponse,
} from "../../lib/diagnostics";
import type {
  BuildCheck, DiagnosticOperation, DiagnosticSnapshot, LayoutSnapshot, MotionSnapshot, WorkerCheck,
} from "../../lib/diagnostics";

const buffer = createDiagnosticBuffer(() => performance.now());
const pointers = new Map<number, { at: number; type: string }>();
const touches = new Map<number, number>();
let controllerChanged = false;

const safelyRecord = (record: () => void) => {
  if (typeof window === "undefined") return;
  try { record(); } catch { buffer.recordingFailed(); }
};

export const recordRenderError = (scope: "application" | "feed" | "post-body", error: unknown) =>
  safelyRecord(() => buffer.runtime(scope, error));
export const recordEmbedFailure = () => safelyRecord(() => buffer.resource("embed"));

export function diagnosticRequest<T extends { status: number }>(
  operation: DiagnosticOperation,
  method: string,
  send: () => Promise<T>
): Promise<T> {
  if (typeof window === "undefined") return send();
  return observeRequest(
    send,
    (result) => buffer.request({ operation, method: method.toUpperCase(), ...result }),
    (error) => ({
      status: axios.isAxiosError(error) ? error.response?.status ?? null : null,
      cancelled: axios.isCancel(error) || (error instanceof Error && error.name === "AbortError"),
    }),
    () => buffer.recordingFailed(),
    () => performance.now()
  );
}

export const diagnosticFetch = (operation: DiagnosticOperation, url: string, init?: RequestInit) =>
  diagnosticRequest(operation, init?.method ?? "GET", () => fetch(url, init));

const mediaTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  !target.closest("[data-troddit-diagnostics-ui]") &&
  !!target.closest("[data-troddit-media-rail]");

export function installDiagnosticListeners() {
  const onPointerDown = (event: PointerEvent) => safelyRecord(() => {
    if (!Number.isFinite(event.pointerId)) return;
    // A new primary touch proves older touch contacts are no longer active.
    if (event.pointerType === "touch" && event.isPrimary) {
      for (const [id, pointer] of pointers) if (pointer.type === "touch") pointers.delete(id);
      touches.clear();
    }
    pointers.delete(event.pointerId);
    if (mediaTarget(event.target)) pointers.set(event.pointerId, { at: performance.now(), type: event.pointerType });
  });
  const onPointerEnd = (event: PointerEvent) => safelyRecord(() => {
    if (!Number.isFinite(event.pointerId)) return;
    if (pointers.delete(event.pointerId) && event.type === "pointercancel") buffer.gestureCancelled();
  });
  const onTouchStart = (event: TouchEvent) => safelyRecord(() => {
    const active = Array.from(event.touches);
    const ids = new Set(active.map((touch) => touch.identifier));
    for (const id of touches.keys()) if (!ids.has(id)) touches.delete(id);
    if (!active.some((touch) => mediaTarget(touch.target))) {
      for (const [id, pointer] of pointers) if (pointer.type === "touch") pointers.delete(id);
    }
    if (mediaTarget(event.target)) {
      for (const touch of Array.from(event.changedTouches)) touches.set(touch.identifier, performance.now());
    }
  });
  const onTouchEnd = (event: TouchEvent) => safelyRecord(() => {
    let tracked = false;
    for (const touch of Array.from(event.changedTouches)) tracked = touches.delete(touch.identifier) || tracked;
    if (tracked && event.type === "touchcancel") buffer.gestureCancelled();
  });
  const clearInputs = () => { pointers.clear(); touches.clear(); };
  const onVisibility = () => { if (document.hidden) clearInputs(); };
  const onError = (event: Event) => safelyRecord(() => {
    const target = event.target;
    const activeMedia = target instanceof Element && !!target.closest('[data-troddit-media-rail], [data-troddit-overlay="post"], [data-troddit-media-preview]');
    if (target instanceof HTMLImageElement) {
      if (activeMedia) buffer.resource("image");
    } else if (target instanceof HTMLMediaElement) {
      if (activeMedia) buffer.resource("video", target.error?.code);
    }
    else if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
      const url = new URL(target instanceof HTMLScriptElement ? target.src : target.href, window.location.origin);
      if (url.origin === window.location.origin && url.pathname.startsWith("/_next/")) buffer.resource("app-code");
    } else if (event instanceof ErrorEvent) buffer.runtime("window", event.error);
  });
  const onRejection = (event: PromiseRejectionEvent) => safelyRecord(() => buffer.runtime("window", event.reason));
  let workerContainer: ServiceWorkerContainer | undefined;
  let priorController: ServiceWorker | null = null;
  try {
    workerContainer = "serviceWorker" in navigator ? navigator.serviceWorker : undefined;
    priorController = workerContainer?.controller ?? null;
  } catch {
    buffer.recordingFailed();
  }
  const onControllerChange = () => safelyRecord(() => {
    if (priorController) controllerChanged = true;
    priorController = workerContainer?.controller ?? null;
  });
  window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  window.addEventListener("pointerup", onPointerEnd, { capture: true, passive: true });
  window.addEventListener("pointercancel", onPointerEnd, { capture: true, passive: true });
  window.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  window.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
  window.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: true });
  window.addEventListener("blur", clearInputs);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  workerContainer?.addEventListener("controllerchange", onControllerChange);
  return () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerEnd, true);
    window.removeEventListener("pointercancel", onPointerEnd, true);
    window.removeEventListener("touchstart", onTouchStart, true);
    window.removeEventListener("touchend", onTouchEnd, true);
    window.removeEventListener("touchcancel", onTouchEnd, true);
    window.removeEventListener("blur", clearInputs);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    workerContainer?.removeEventListener("controllerchange", onControllerChange);
    clearInputs();
  };
}

const numericAttribute = (element: HTMLElement, name: string): number | null => {
  const value = element.getAttribute(name);
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const rendered = (element: Element) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
};
const countRendered = (selector: string) => Array.from(document.querySelectorAll(selector)).filter(rendered).length;
const overflow = (element: Element) => {
  const value = getComputedStyle(element).overflowY;
  return ["hidden", "clip", "visible", "auto", "scroll"].includes(value) ? value : "unknown";
};
const motion = (element: HTMLElement, axis: "x" | "y", expected: number | null): MotionSnapshot => {
  const translation = parseTranslation(getComputedStyle(element).transform);
  const at = numericAttribute(element, "data-troddit-motion-at");
  return {
    offset: translation?.[axis] ?? null,
    expected,
    quietForMs: at === null ? null : Math.max(0, Math.round(performance.now() - at)),
  };
};
const emptyLayout = (): LayoutSnapshot => ({
  available: false, htmlOverflowY: "unknown", bodyOverflowY: "unknown",
  owners: { post: 0, navigation: 0, peek: 0, dialog: 0, fullscreen: false },
  modalX: null, railY: null, activeMediaInput: false, zoom: null, renderErrors: 0,
});
function captureLayout(): LayoutSnapshot {
  try {
    const posts = Array.from(document.querySelectorAll<HTMLElement>('[data-troddit-overlay="post"]')).filter(rendered);
    const root = posts.length === 1 ? posts[0] : null;
    const rails = root ? Array.from(root.querySelectorAll<HTMLElement>("[data-troddit-media-rail]")).filter((element) => getComputedStyle(element).display !== "none") : [];
    const rail = rails.length === 1 ? rails[0] : null;
    const index = rail ? numericAttribute(rail, "data-troddit-index") : null;
    const height = rail ? numericAttribute(rail, "data-troddit-writer-height") : null;
    const expected = index !== null && Number.isSafeInteger(index) && index >= 0 && height !== null && height > 0 ? -index * height : null;
    const lock = getComputedStyle(document.documentElement).getPropertyValue("--overflow").trim();
    const inlineOverflow = document.documentElement.style.overflowY;
    const padding = Number.parseFloat(document.documentElement.style.paddingRight || "0");
    return {
      available: true, htmlOverflowY: overflow(document.documentElement), bodyOverflowY: overflow(document.body),
      applicationLock: lock === "hidden hidden" ? "locked" : lock === "hidden visible" ? "unlocked" : "other",
      htmlInlineOverflowY: ["hidden", "clip", "visible", "auto", "scroll"].includes(inlineOverflow) ? inlineOverflow : "unset",
      htmlPaddingRightPx: Number.isFinite(padding) ? padding : null,
      owners: {
        post: posts.length,
        navigation: countRendered('[data-troddit-overlay="navigation"]'),
        peek: countRendered('[data-troddit-overlay="peek"]'),
        dialog: countRendered('[role="dialog"][aria-modal="true"]:not([data-troddit-diagnostics-ui])'),
        fullscreen: !!document.fullscreenElement ||
          ("webkitFullscreenElement" in document && !!document.webkitFullscreenElement) ||
          Array.from(document.querySelectorAll("video")).some((video) => "webkitDisplayingFullscreen" in video && video.webkitDisplayingFullscreen === true),
      },
      modalX: root ? motion(root, "x", 0) : null,
      railY: rail ? motion(rail, "y", expected) : null,
      activeMediaInput: pointers.size > 0 || touches.size > 0,
      inputTrackingStale: [...pointers.values()].some((pointer) => performance.now() - pointer.at > 10_000) ||
        [...touches.values()].some((at) => performance.now() - at > 10_000),
      zoom: rail ? numericAttribute(rail, "data-troddit-zoom") : 1,
      renderErrors: countRendered("[data-troddit-render-error]"),
    };
  } catch {
    buffer.recordingFailed();
    return emptyLayout();
  }
}

function clientBuildId() {
  try {
    const data: unknown = JSON.parse(document.getElementById("__NEXT_DATA__")?.textContent ?? "null");
    return typeof data === "object" && data !== null && "buildId" in data ? buildId(data.buildId) : null;
  } catch {
    buffer.recordingFailed();
    return null;
  }
}
function browserIdentity(ua: string) {
  const candidates = [
    ["Edge", /(?:Edg|EdgiOS)\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ] as const;
  for (const [family, pattern] of candidates) {
    const match = ua.match(pattern);
    if (match) return { family, version: match[1].slice(0, 32) };
  }
  return { family: "unknown", version: null };
}
function viewKind(path: string): DiagnosticSnapshot["client"]["view"] {
  const pathname = path.split(/[?#]/)[0];
  if (/\/comments\//.test(pathname)) return "post";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/search")) return "search";
  if (pathname === "/" || /^\/(?:r|u)\//.test(pathname)) return "feed";
  return "other";
}

export function captureDiagnostics(
  queryClient: QueryClient,
  version: string,
  revision: string | undefined,
  currentPath: string,
  source: DiagnosticSnapshot["captureSource"]
): DiagnosticSnapshot {
  const layout = captureLayout();
  let cache: ReturnType<typeof inspectFeedCache>;
  try {
    cache = inspectFeedCache(queryClient.getQueriesData(["feed"]).map(([, data]) => data));
  } catch {
    cache = { loaded: 0, malformed: 0, unreadable: 1 };
  }
  const visual = window.visualViewport;
  const ua = navigator.userAgent;
  return {
    capturedAt: new Date().toISOString(),
    captureSource: source,
    client: { buildId: clientBuildId(), revision: buildRevision(revision), version, view: layout.owners.post > 0 ? "post" : viewKind(currentPath) },
    browser: {
      ...browserIdentity(ua),
      platform: /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : "other",
      standalone: window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && navigator.standalone === true),
      online: navigator.onLine, secure: window.isSecureContext,
    },
    viewport: {
      width: window.innerWidth, height: window.innerHeight,
      visualWidth: visual?.width ?? null, visualHeight: visual?.height ?? null,
      offsetTop: visual?.offsetTop ?? null, offsetLeft: visual?.offsetLeft ?? null,
      scale: visual?.scale ?? null,
    },
    layout, cache, events: buffer.snapshot(), recorderFailures: buffer.failures,
  };
}

export async function checkServerBuild(): Promise<BuildCheck> {
  if (!window.crypto?.getRandomValues) return { status: "unavailable", reason: "unsupported" };
  let nonce: string;
  try {
    nonce = Array.from(window.crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
  } catch {
    return { status: "unavailable", reason: "unsupported" };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 4000);
  try {
    // POST also bypasses the GET-only routes in already-installed old workers.
    const response = await fetch("/api/build-info", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce }), signal: controller.signal,
    });
    if (!response.ok) return { status: "unavailable", reason: "http", httpStatus: response.status };
    let value: unknown;
    try { value = await response.json(); } catch {
      return { status: "unavailable", reason: "invalid-response" };
    }
    return validateBuildResponse(value, nonce, new Date().toISOString());
  } catch {
    return { status: "unavailable", reason: timedOut ? "timeout" : "network" };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function inspectWorker(): Promise<WorkerCheck> {
  if (!("serviceWorker" in navigator)) return { status: "unsupported" };
  let timeout: number | undefined;
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.getRegistration(),
      new Promise<null>((resolve) => { timeout = window.setTimeout(() => resolve(null), 2000); }),
    ]);
    if (registration === null) return { status: "unavailable" };
    if (!registration) return { status: "unregistered" };
    return {
      status: "registered", controlled: !!navigator.serviceWorker.controller,
      controllerChanged,
      active: ["installing", "installed", "activating", "activated", "redundant"].find((state) => state === registration.active?.state) ?? null,
      waiting: !!registration.waiting, installing: !!registration.installing,
    };
  } catch {
    return { status: "unavailable" };
  } finally {
    window.clearTimeout(timeout);
  }
}
