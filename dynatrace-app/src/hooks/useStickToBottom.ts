import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

// How close to the end still counts as "reading the latest".
const NEAR_BOTTOM_PX = 48;

// Keeps a scrolling conversation on its latest message while new content
// arrives, unless the user scrolled up to read something. `resetKey` is the
// session: opening another one starts at its end again.
export function useStickToBottom<T extends HTMLElement>(resetKey: unknown, content: unknown) {
  const ref = useRef<T>(null);
  const pinned = useRef(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  useEffect(() => {
    pinned.current = true;
  }, [resetKey]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [resetKey, content]);

  return { ref, onScroll };
}
