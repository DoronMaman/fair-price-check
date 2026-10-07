/**
 * A signal that aborts after `ms` or when `parent` aborts — whichever comes first.
 *
 * Hand-rolled on purpose: AbortSignal.any needs Safari 17.4+ and AbortSignal.timeout
 * Safari 16+. On older iPhones those throw a TypeError, which surfaced as a fake
 * "no connection" error and made every search fail.
 */
export function timeoutSignal(
  ms: number,
  parent?: AbortSignal,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);
  const onParentAbort = () => ctrl.abort();
  if (parent?.aborted) ctrl.abort();
  else parent?.addEventListener('abort', onParentAbort, { once: true });
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}
