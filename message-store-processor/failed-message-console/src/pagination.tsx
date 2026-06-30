import { useCallback, useEffect, useState } from "react";
import type { Page } from "./types";

/**
 * Cursor-based pagination over an endpoint returning {items, nextPageToken,
 * hasMore}. Keeps a stack of page tokens so the user can go back and forth.
 */
export function usePagedList<T>(
  fetchPage: (pageToken: string | undefined) => Promise<Page<T>>,
  deps: unknown[],
) {
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  const [data, setData] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetcher = useCallback(fetchPage, deps);

  // Reset to the first page whenever the query (deps) changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setStack([undefined]), deps);

  const token = stack[stack.length - 1];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetcher(token)
      .then((p) => alive && (setData(p), setError(null)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [fetcher, token, tick]);

  return {
    items: data?.items ?? [],
    loading,
    error,
    pageIndex: stack.length - 1,
    canPrev: stack.length > 1,
    canNext: Boolean(data?.hasMore && data?.nextPageToken),
    next: () => data?.nextPageToken && setStack((s) => [...s, data.nextPageToken!]),
    prev: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    reload: () => setTick((t) => t + 1),
  };
}

export function Pager({
  pageIndex,
  canPrev,
  canNext,
  onPrev,
  onNext,
  count,
}: {
  pageIndex: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  count: number;
}) {
  if (!canPrev && !canNext) {
    return <span className="muted small">{count} item(s)</span>;
  }
  return (
    <div className="pager">
      <button className="btn small" disabled={!canPrev} onClick={onPrev}>
        ← Prev
      </button>
      <span className="muted small">Page {pageIndex + 1}</span>
      <button className="btn small" disabled={!canNext} onClick={onNext}>
        Next →
      </button>
    </div>
  );
}
