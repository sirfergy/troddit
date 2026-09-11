import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { buildRevision, checkServerBuild, deploymentStatus, pageBuildId } from "../lib/appUpdates";
import type { BuildCheck, VerifiedBuild } from "../lib/appUpdates";
import AppUpdatesDialog from "./components/AppUpdatesDialog";

const checkInterval = 5 * 60 * 1000;
const noticeId = "app-update";
const AppUpdatesContext = createContext<{
  isOpen: boolean;
  updateAvailable: boolean;
  openUpdates: () => void;
} | null>(null);

export function useAppUpdates() {
  const context = useContext(AppUpdatesContext);
  if (!context) throw new Error("AppUpdatesProvider is required");
  return context;
}

export function AppUpdatesProvider({ children, version }: { children: React.ReactNode; version: string }) {
  const [isOpen, setOpen] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [check, setCheck] = useState<BuildCheck>({ status: "idle" });
  const [lastVerified, setLastVerified] = useState<VerifiedBuild | null>(null);
  const [checking, setChecking] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const lastCheck = useRef(0);
  const notifiedBuild = useRef<string | null>(null);

  const checkBuild = useCallback(async (force = false) => {
    if (pending.current || document.visibilityState !== "visible") return;
    if (!force && Date.now() - lastCheck.current < checkInterval) return;
    lastCheck.current = Date.now();
    if (!navigator.onLine) {
      setCheck({ status: "unavailable", reason: "offline" });
      return;
    }
    pending.current = true;
    setChecking(true);
    const result = await checkServerBuild();
    pending.current = false;
    if (!mounted.current) return;
    setChecking(false);
    if (navigator.onLine && result.status === "verified") setLastVerified(result);
    setCheck(navigator.onLine ? result : { status: "unavailable", reason: "offline" });
  }, []);

  useEffect(() => {
    mounted.current = true;
    setClientId(pageBuildId(document.getElementById("__NEXT_DATA__")?.textContent ?? null));
    const resume = () => { void checkBuild(); };
    const reconnect = () => { void checkBuild(true); };
    const offline = () => { setCheck({ status: "unavailable", reason: "offline" }); };
    resume();
    const timer = window.setInterval(resume, checkInterval);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", offline);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", offline);
      toast.remove(noticeId);
    };
  }, [checkBuild]);

  const openUpdates = useCallback(() => {
    toast.remove(noticeId);
    setOpen(true);
    void checkBuild();
  }, [checkBuild]);
  const updateAvailable = deploymentStatus(clientId, lastVerified ?? { status: "idle" }) === "different";

  useEffect(() => {
    if (!updateAvailable || check.status !== "verified") {
      toast.remove(noticeId);
      return;
    }
    if (isOpen) {
      notifiedBuild.current = check.buildId;
      toast.remove(noticeId);
      return;
    }
    if (notifiedBuild.current === check.buildId) return;
    notifiedBuild.current = check.buildId;
    toast.custom((t) => (
      <div {...t.ariaProps} className="max-w-sm p-3 border rounded-lg shadow-lg bg-th-background2 border-th-border text-th-text">
        <p className="text-sm">A different Troddit build is available.</p>
        <div className="flex gap-4 mt-2 text-sm">
          <button type="button" className="font-semibold text-th-accent" onClick={openUpdates}>Review update</button>
          <button type="button" onClick={() => toast.remove(t.id)}>Dismiss update notice</button>
        </div>
      </div>
    ), { id: noticeId, duration: 10000 });
  }, [check, isOpen, openUpdates, updateAvailable]);

  const actions = useMemo(() => ({ isOpen, updateAvailable, openUpdates }), [isOpen, updateAvailable, openUpdates]);
  return (
    <AppUpdatesContext.Provider value={actions}>
      {children}
      <AppUpdatesDialog
        open={isOpen}
        version={version}
        clientId={clientId}
        revision={buildRevision(process.env.NEXT_PUBLIC_BUILD_REVISION)}
        check={check}
        lastVerified={lastVerified}
        checking={checking}
        onCheck={() => { void checkBuild(true); }}
        onClose={() => setOpen(false)}
      />
    </AppUpdatesContext.Provider>
  );
}
