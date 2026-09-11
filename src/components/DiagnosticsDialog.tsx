import { Dialog } from "@headlessui/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DiagnosticReport } from "../../lib/diagnostics";

const buttonStyle = "px-3 py-2 border rounded-md border-th-border hover:bg-th-highlight";

export default function DiagnosticsDialog({
  open, report, onClose, onCheckBuild,
}: {
  open: boolean;
  report: DiagnosticReport | null;
  onClose: () => void;
  onCheckBuild: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [viewport, setViewport] = useState({ top: 0, left: 0, width: 0, height: 0 });
  useEffect(() => {
    if (!open) return;
    setCopyStatus("");
    setShowReport(false);
    setConfirmReload(false);
    const measure = () => {
      const visual = window.visualViewport;
      setViewport({
        top: visual?.offsetTop ?? 0, left: visual?.offsetLeft ?? 0,
        width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [open]);

  const serialized = useMemo(() => JSON.stringify(report, null, 2), [report]);
  if (!report) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serialized);
      setCopyStatus(report.build.status === "checking"
        ? "Report copied. Copy again after the build check finishes to include that result."
        : "Report copied.");
    } catch {
      setShowReport(true);
      setCopyStatus("Clipboard access failed. Select the report text below and copy it manually.");
    }
  };
  const { snapshot, build, worker } = report;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      initialFocus={closeRef}
      data-troddit-diagnostics-ui
      className="fixed z-[2000] overflow-hidden"
      style={{
        top: viewport.top, left: viewport.left,
        width: viewport.width || "100%", height: viewport.height || "100%",
      }}
    >
      <Dialog.Overlay className="absolute inset-0 bg-black/70" />
      <section
        className="relative flex flex-col max-w-3xl h-full mx-auto border rounded-lg shadow-xl bg-th-background2 border-th-border text-th-text"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="flex-none p-3 border-b border-th-border">
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title as="h2" className="text-lg font-semibold">Diagnose this view</Dialog.Title>
            <button ref={closeRef} type="button" className={buttonStyle} onClick={onClose}>Close diagnosis</button>
          </div>
          <p className="mt-1 text-xs text-th-textLight">
            Frozen before opening this panel: {new Date(snapshot.capturedAt).toLocaleString()} ({snapshot.captureSource}).
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className={`${buttonStyle} font-semibold`} onClick={copy}>Copy diagnostic report</button>
            <button type="button" className={buttonStyle} onClick={() => setShowReport((value) => !value)}>View report</button>
          </div>
          {copyStatus && <p role="status" className="mt-2 text-sm">{copyStatus}</p>}
        </header>
        <div className="flex-auto min-h-0 p-3 space-y-4 overflow-y-auto overscroll-contain">
          <p className="text-sm">
            These checks identify measured failures and possible contributors, not every Safari rendering bug.
            The captured view does not change when the build check finishes.
          </p>
          {report.findings.map((finding, index) => (
            <article key={`${finding.code}-${index}`} className="p-3 border rounded-md border-th-border">
              <p className="text-xs font-semibold uppercase text-th-accent">{finding.confidence}</p>
              <h3 className="mt-1 font-semibold">{finding.title}</h3>
              <p className="mt-1 text-sm">{finding.explanation}</p>
              {finding.evidence.length > 0 && (
                <ul className="my-2 ml-4 text-xs list-disc">
                  {finding.evidence.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
              <p className="text-sm"><strong>Next:</strong> {finding.nextStep}</p>
            </article>
          ))}
          <section className="p-3 border rounded-md border-th-border">
            <h3 className="font-semibold">Deployment and browser context</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-2 text-xs break-all">
              <dt>Page build</dt><dd>{snapshot.client.buildId ?? "Unavailable"}</dd>
              <dt>Page revision</dt><dd>{snapshot.client.revision ?? "Not supplied by this build"}</dd>
              <dt>Captured view</dt><dd>{snapshot.client.view}</dd>
              <dt>Server build</dt><dd>{build.status === "verified" ? build.buildId : build.status}</dd>
              <dt>Server revision</dt><dd>{build.status === "verified" ? build.revision ?? "Not supplied" : "Not verified"}</dd>
              <dt>Worker</dt><dd>{worker.status === "registered" ? `${worker.active ?? "no active worker"}; controlled: ${worker.controlled}; waiting: ${worker.waiting}; controller changed: ${worker.controllerChanged}` : worker.status}</dd>
              <dt>Browser</dt><dd>{snapshot.browser.family} {snapshot.browser.version ?? ""} / {snapshot.browser.platform}</dd>
              <dt>Standalone</dt><dd>{String(snapshot.browser.standalone)}</dd>
              <dt>Layout viewport</dt><dd>{snapshot.viewport.width} x {snapshot.viewport.height}</dd>
              <dt>Visible viewport</dt><dd>{snapshot.viewport.visualWidth ?? "unknown"} x {snapshot.viewport.visualHeight ?? "unknown"}; scale {snapshot.viewport.scale ?? "unknown"}</dd>
            </dl>
            <p className="mt-2 text-xs">Viewport differences can be normal with a keyboard, zoom, or browser chrome. They are not diagnosed as a bug on their own.</p>
            <button type="button" className={`${buttonStyle} mt-3 text-sm`} onClick={onCheckBuild} disabled={build.status === "checking"}>
              Check deployed build
            </button>
          </section>
          <section className="text-sm">
            <h3 className="font-semibold">Privacy and limitations</h3>
            <p>The report stays in this tab until you copy it. It excludes browsing URLs, account/post identifiers, content, credentials, headers, and raw exception text. Recent events are bounded and kept only in memory.</p>
            <p className="mt-1">If the screen still looks wrong, attach a screenshot. Browser measurements cannot confirm a paint-only iPhone problem, and the event list is not a complete network log.</p>
          </section>
          {showReport && (
            <label className="block text-sm">
              Redacted diagnostic report
              <textarea readOnly value={serialized} rows={10} className="w-full p-2 mt-1 font-mono text-xs border rounded bg-th-base border-th-border" onFocus={(event) => event.currentTarget.select()} />
            </label>
          )}
          <section className="p-3 border rounded-md border-th-border">
            <h3 className="font-semibold">Deliberate recovery</h3>
            {confirmReload ? (
              <>
                <p className="my-2 text-sm">Reloading closes the current view and can discard unsent replies. Copy the report first. Saved settings and local feeds will not be cleared.</p>
                <div className="flex gap-2">
                  <button type="button" className={buttonStyle} onClick={() => setConfirmReload(false)}>Cancel reload</button>
                  <button type="button" className={buttonStyle} onClick={() => window.location.reload()}>Reload now</button>
                </div>
              </>
            ) : (
              <button type="button" className={`${buttonStyle} mt-2`} onClick={() => setConfirmReload(true)}>Reload app...</button>
            )}
          </section>
        </div>
      </section>
    </Dialog>
  );
}
