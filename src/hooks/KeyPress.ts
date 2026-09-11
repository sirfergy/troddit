import { useState, useEffect } from "react";
import { useMainContext } from "../MainContext";
import { useDiagnosticsOpen } from "../diagnostics/context";

export const useKeyPress = (targetKey) => {
  const context: any = useMainContext();
  const diagnosticsOpen = useDiagnosticsOpen();
  // State for keeping track of whether key is pressed
  const [keyPressed, setKeyPressed] = useState<boolean>(false);
  // If pressed key is our target key then set to true
  function downHandler(event: KeyboardEvent) {
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="dialog"][data-troddit-diagnostics-ui]'))) return;
    const { metaKey, ctrlKey, key } = event;
    if (key === targetKey && !(ctrlKey || metaKey)) {
      setKeyPressed(true);
    } 
  }
  // If released key is our target key then set to false
  const upHandler = ({ key }) => {
    if (key === targetKey) {
      setKeyPressed(false);
    }
  };
  // Add event listeners
  useEffect(() => {
    if (!context.replyFocus && !diagnosticsOpen) {
      window.addEventListener("keydown", downHandler);
      window.addEventListener("keyup", upHandler);
    } else {
      setKeyPressed(false);
    }

    // Remove event listeners on cleanup
    return () => {
      window.removeEventListener("keydown", downHandler);
      window.removeEventListener("keyup", upHandler);
    };
  }, [context.replyFocus, diagnosticsOpen]);
  return keyPressed;
};
