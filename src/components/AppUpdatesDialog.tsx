import { Dialog } from "@headlessui/react";
import React, { useEffect, useRef, useState } from "react";
import { deploymentStatus } from "../../lib/appUpdates";
import type { BuildCheck, VerifiedBuild } from "../../lib/appUpdates";

const buttonStyle = "px-3 py-2 border rounded-md border-th-border hover:bg-th-highlight disabled:opacity-50";
const failureMessages = {
  offline: "You're offline. The deployed build could not be checked.",
  network: "The update check failed. Check your connection and try again.",
  timeout: "The update check timed out. Try again when your connection is ready.",
  http: "The server could not supply build information. Try again later.",
  "invalid-response": "The server returned invalid build information. Update status is unknown.",
  "unverified-freshness": "The response could not be verified as fresh. Update status is unknown.",
  unsupported: "This browser cannot verify update checks.",
};

export default function AppUpdatesDialog({
  open, version, clientId, revision, check, lastVerified, checking, onCheck, onClose,
}: {
  open: boolean;
  version: string;
  clientId: string | null;
  revision: string | null;
  check: BuildCheck;
  lastVerified: VerifiedBuild | null;
  checking: boolean;
  onCheck: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  useEffect(() => { setConfirmReload(false); }, [open]);
  const status = deploymentStatus(clientId, check);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      initialFocus={closeRef}
      data-app-updates
      className="fixed inset-0 z-[2000] overflow-y-auto overscroll-contain"
    >
      <Dialog.Overlay className="fixed inset-0 bg-black/70" />
      <div
        className="relative flex items-center justify-center min-h-full p-4"
        style={{
          paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))",
          paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
          paddingLeft: "calc(1rem + env(safe-area-inset-left, 0px))",
          paddingRight: "calc(1rem + env(safe-area-inset-right, 0px))",
        }}
      >
        <section
          className="w-full max-w-lg p-4 space-y-4 border rounded-lg shadow-xl bg-th-background2 border-th-border text-th-text"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              event.preventDefault();
              onClose();
            }
          }}
        >
          <header className="flex items-center justify-between gap-3">
            <Dialog.Title as="h2" className="text-lg font-semibold">App updates</Dialog.Title>
            <button ref={closeRef} type="button" className={buttonStyle} onClick={onClose}>Close updates</button>
          </header>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm break-all">
            <dt>App version</dt><dd>{version}</dd>
            <dt>Page build</dt><dd>{clientId ?? "Unavailable"}</dd>
            <dt>Page revision</dt><dd>{revision ?? "Not supplied by this build"}</dd>
            {check.status === "verified" && (
              <>
                <dt>Deployed version</dt><dd>{check.version}</dd>
                <dt>Deployed build</dt><dd>{check.buildId}</dd>
                <dt>Deployed revision</dt><dd>{check.revision ?? "Not supplied"}</dd>
              </>
            )}
          </dl>
          <div role="status" className="text-sm">
            {checking ? <p>Checking for updates...</p> : check.status === "unavailable" ? (
              <p>{failureMessages[check.reason]}</p>
            ) : (
              <p>{status === "same" ? "You're on the deployed build." :
                status === "different" ? "A different build is available. Reload when you're ready." :
                status === "development" ? "Development build: deployment comparison is disabled." :
                check.status === "verified" ? "The page build is unavailable, so update status is unknown." :
                "The deployed build has not been checked yet."}</p>
            )}
            {check.status === "verified" && <p className="mt-1 text-xs text-th-textLight">Last checked: {new Date(check.checkedAt).toLocaleString()}</p>}
            {check.status === "unavailable" && lastVerified && deploymentStatus(clientId, lastVerified) === "different" && (
              <p className="mt-2">A different build was available at the last successful check ({new Date(lastVerified.checkedAt).toLocaleString()}). Check again to confirm.</p>
            )}
          </div>
          <button type="button" className={buttonStyle} disabled={checking} onClick={onCheck}>Check for updates</button>
          <p className="text-xs text-th-textLight">
            Different builds can be rebuilds or rollbacks, not necessarily newer code. Updates never reload this page automatically.
          </p>
          <section className="pt-4 border-t border-th-border">
            {confirmReload ? (
              <>
                <p className="mb-3 text-sm">Reloading closes the current view and can discard unsent replies. Saved settings and local feeds will not be cleared. Offline or failed navigation may reopen a cached build.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonStyle} onClick={() => setConfirmReload(false)}>Cancel reload</button>
                  <button type="button" className={buttonStyle} onClick={() => window.location.reload()}>Reload now</button>
                </div>
              </>
            ) : (
              <button type="button" className={buttonStyle} onClick={() => setConfirmReload(true)}>Reload app...</button>
            )}
          </section>
        </section>
      </div>
    </Dialog>
  );
}
