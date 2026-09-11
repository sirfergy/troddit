import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import type { QueryClient } from "@tanstack/react-query";
import { ErrorBoundary } from "react-error-boundary";
import { diagnose } from "../../lib/diagnostics";
import type { DiagnosticReport, DiagnosticSnapshot } from "../../lib/diagnostics";
import { DiagnosticsContext, useDiagnosticCaptureHandlers, useDiagnostics } from "../diagnostics/context";
import { captureDiagnostics, checkServerBuild, inspectWorker, installDiagnosticListeners, recordRenderError } from "../diagnostics/runtime";
import DiagnosticsDialog from "./DiagnosticsDialog";

function DiagnosticCrashFallback() {
  const { openDiagnostics } = useDiagnostics();
  const capture = useDiagnosticCaptureHandlers();
  return (
    <div role="alert" data-troddit-render-error className="p-6 mt-16 text-th-text">
      <h1 className="text-xl">Troddit could not render this view.</h1>
      <button {...capture} type="button" className="px-3 py-2 mt-3 border rounded border-th-border" onClick={openDiagnostics}>
        Diagnose this view
      </button>
    </div>
  );
}

export default function DiagnosticsProvider({
  children, queryClient, version,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
  version: string;
}) {
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const openRef = useRef(false);
  const prepared = useRef<DiagnosticSnapshot | null>(null);
  const sequence = useRef(0);

  useEffect(() => installDiagnosticListeners(), []);
  useEffect(() => () => { sequence.current++; }, []);

  const capture = useCallback((source: DiagnosticSnapshot["captureSource"]) =>
    captureDiagnostics(queryClient, version, process.env.NEXT_PUBLIC_BUILD_REVISION, router.asPath, source),
  [queryClient, version, router.asPath]);

  const prepareCapture = useCallback((source: "pointer" | "keyboard") => {
    if (!openRef.current) prepared.current = capture(source);
  }, [capture]);

  const checkContext = useCallback(async (id: number) => {
    const [build, worker] = await Promise.all([checkServerBuild(), inspectWorker()]);
    setReport((previous) => sequence.current === id && previous ? {
      ...previous, build, worker, findings: diagnose(previous.snapshot, build, worker),
    } : previous);
  }, []);

  const openDiagnostics = useCallback(() => {
    if (openRef.current) return;
    const snapshot = prepared.current ?? capture("direct");
    prepared.current = null;
    const id = ++sequence.current;
    const next: DiagnosticReport = {
      schema: "troddit-diagnostics/v1", snapshot,
      build: { status: "checking" }, worker: { status: "checking" },
      findings: diagnose(snapshot, { status: "checking" }, { status: "checking" }),
    };
    setReport(next);
    openRef.current = true;
    setOpen(true);
    void checkContext(id);
  }, [capture, checkContext]);

  const close = useCallback(() => {
    openRef.current = false;
    sequence.current++;
    setOpen(false);
  }, []);

  const checkBuild = useCallback(() => {
    const id = ++sequence.current;
    setReport((previous) => previous ? {
      ...previous, build: { status: "checking" }, worker: { status: "checking" },
      findings: diagnose(previous.snapshot, { status: "checking" }, { status: "checking" }),
    } : previous);
    void checkContext(id);
  }, [checkContext]);
  const actions = useMemo(() => ({ isOpen, prepareCapture, openDiagnostics }), [isOpen, prepareCapture, openDiagnostics]);

  return (
    <DiagnosticsContext.Provider value={actions}>
      <ErrorBoundary FallbackComponent={DiagnosticCrashFallback} onError={(error) => recordRenderError("application", error)}>
        {children}
      </ErrorBoundary>
      <DiagnosticsDialog open={isOpen} report={report} onClose={close} onCheckBuild={checkBuild} />
    </DiagnosticsContext.Provider>
  );
}
