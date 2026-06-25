import { useEffect, useLayoutEffect, useRef, useState } from "react";

type PullToRefreshOptions = {
  // Action to run when the pull crosses the threshold. May return a promise; if
  // it does, the indicator retracts when it settles.
  onRefresh: () => void | Promise<unknown>;
  // Disable the gesture entirely (e.g. while a modal is open or a fetch is active).
  disabled?: boolean;
  // Pull distance (px) required to trigger a refresh.
  threshold?: number;
  // Maximum visual pull distance (px); the pull is damped past this.
  maxPull?: number;
};

const SLOP = 8;

// Touch-only pull-to-refresh for the window-scrolled feed. Engages only when the
// page is scrolled to the very top and the gesture is a downward, vertically
// dominant drag, so it never hijacks normal scrolling or horizontal card swipes.
const usePullToRefresh = ({
  onRefresh,
  disabled = false,
  threshold = 70,
  maxPull = 110,
}: PullToRefreshOptions) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const pull = useRef(0);
  const startY = useRef(0);
  const startX = useRef(0);
  const engaged = useRef(false);
  const tracking = useRef(false);
  const triggered = useRef(false);
  const mounted = useRef(true);
  const timeoutId = useRef(0);

  // Keep latest props in refs so the listener effect never re-subscribes on them.
  const onRefreshRef = useRef(onRefresh);
  const disabledRef = useRef(disabled);
  useLayoutEffect(() => {
    onRefreshRef.current = onRefresh;
    disabledRef.current = disabled;
  });

  const setPull = (v: number) => {
    pull.current = v;
    setPullDistance(v);
  };

  // If the gesture gets disabled mid-pull (e.g. a modal opens), retract.
  useEffect(() => {
    if (disabled && !triggered.current) {
      tracking.current = false;
      engaged.current = false;
      setPull(0);
    }
  }, [disabled]);

  // Clear any pending retract timeout and flag unmount so callbacks don't setState.
  useEffect(
    () => () => {
      mounted.current = false;
      if (timeoutId.current) clearTimeout(timeoutId.current);
    },
    []
  );

  useEffect(() => {
    const atTop = () =>
      (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    // Reset gesture state without firing a refresh.
    const stop = () => {
      tracking.current = false;
      engaged.current = false;
      if (!triggered.current) setPull(0);
    };

    // End the refreshing state and retract the indicator.
    const finish = () => {
      if (!mounted.current) return;
      triggered.current = false;
      setRefreshing(false);
      setPull(0);
    };

    const onStart = (e: TouchEvent) => {
      if (disabledRef.current || triggered.current) return;
      if (e.touches.length !== 1 || !atTop()) return;
      tracking.current = true;
      engaged.current = false;
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking.current) return;
      if (disabledRef.current || e.touches.length !== 1) {
        stop();
        return;
      }
      const dy = e.touches[0].clientY - startY.current;
      const dx = e.touches[0].clientX - startX.current;

      // Make a one-time, permanent decision once the finger leaves the slop in
      // any axis: a clean downward top-pull engages; anything else (horizontal,
      // upward, not-at-top) stops tracking so card/gallery swipes are untouched.
      if (!engaged.current) {
        if (Math.abs(dx) <= SLOP && Math.abs(dy) <= SLOP) return;
        if (dy > SLOP && Math.abs(dy) > Math.abs(dx) && atTop() && e.cancelable) {
          engaged.current = true;
        } else {
          tracking.current = false;
          return;
        }
      }

      if (dy <= 0) {
        // Reversed back to/above the start: cancel so a later down-move must
        // re-acquire the gesture from a fresh at-top decision.
        stop();
        return;
      }
      // If the browser already owns the gesture we can't suppress its overscroll;
      // bail rather than letting the indicator desync from the finger.
      if (!e.cancelable) {
        stop();
        return;
      }
      e.preventDefault();
      setPull(Math.min(maxPull, dy * 0.5));
    };

    const onEnd = () => {
      if (engaged.current && pull.current >= threshold && !triggered.current) {
        triggered.current = true;
        setRefreshing(true);
        setPull(threshold);

        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          if (timeoutId.current) {
            clearTimeout(timeoutId.current);
            timeoutId.current = 0;
          }
          finish();
        };
        try {
          const result = onRefreshRef.current();
          if (result && typeof (result as any).then === "function") {
            (result as Promise<unknown>).then(done, done);
            timeoutId.current = window.setTimeout(done, 8000); // backstop
          } else {
            timeoutId.current = window.setTimeout(done, 600); // no promise
          }
        } catch {
          done();
        }
      }
      stop();
    };

    // touchcancel must never count as a successful release.
    const onCancel = () => stop();

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [threshold, maxPull]);

  return {
    pullDistance,
    refreshing,
    ready: pullDistance >= threshold,
  };
};

export default usePullToRefresh;
