import { createContext, useContext } from "react";
import type { KeyboardEvent } from "react";

export interface DiagnosticsActions {
  isOpen: boolean;
  prepareCapture: (source: "pointer" | "keyboard") => void;
  openDiagnostics: () => void;
}

export const DiagnosticsContext = createContext<DiagnosticsActions | null>(null);

export function useDiagnostics() {
  const context = useContext(DiagnosticsContext);
  if (!context) throw new Error("DiagnosticsProvider is missing");
  return context;
}

export const useDiagnosticsOpen = () => useContext(DiagnosticsContext)?.isOpen ?? false;

export function useDiagnosticCaptureHandlers() {
  const { prepareCapture } = useDiagnostics();
  return {
    "data-troddit-diagnostics-ui": true,
    onPointerDownCapture: () => prepareCapture("pointer"),
    onTouchStartCapture: () => {
      if (!("PointerEvent" in window)) prepareCapture("pointer");
    },
    onKeyDownCapture: (event: KeyboardEvent) => {
      if (!event.repeat && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) prepareCapture("keyboard");
    },
  };
}
