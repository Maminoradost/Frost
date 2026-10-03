import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../lib/api';
import type { Page } from '../lib/types';
import { toast } from '../store/ui';

const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 5 * 60 * 1000;

function fresh<T>(key: string | null): T | undefined {
  if (!key) return undefined;
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < TTL ? (hit.data as T) : undefined;
}

interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
}

/** Загрузка данных с простым кэшем в памяти (5 минут). `key = null` отключает запрос. */
export function useAsync<T>(key: string | null, fn: () => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>(() => {
    const data = fresh<T>(key);
    return { data, error: null, loading: !!key && data === undefined };
  });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!key) {
      setState({ data: undefined, error: null, loading: false });
      return;
    }
    const cached = fresh<T>(key);
    if (cached !== undefined) {
      setState({ data: cached, error: null, loading: false });
      return;
    }
    let alive = true;
    setState({ data: undefined, error: null, loading: true });
    fnRef
      .current()
      .then((data) => {
        cache.set(key, { at: Date.now(), data });
        if (alive) setState({ data, error: null, loading: false });
      })
      .catch((e) => {
        if (alive) setState({ data: undefined, error: errorText(e), loading: false });
      });
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => {
    if (key) cache.delete(key);
    setNonce((n) => n + 1);
  }, [key]);

  return { ...state, reload };
}

interface PagedState<T> {
  items: T[];
  next: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const emptyPaged = <T,>(loading: boolean): PagedState<T> => ({
  items: [],
  next: null,
  loading,
  loadingMore: false,
  error: null,
});

/** Постраничная загрузка с кнопкой «Показать ещё». */
export function usePaged<T>(key: string | null, fetchPage: (cursor: string | null) => Promise<Page<T>>) {
  const [state, setState] = useState<PagedState<T>>(() => emptyPaged<T>(!!key));
  const fnRef = useRef(fetchPage);
  fnRef.current = fetchPage;
  const keyRef = useRef(key);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    keyRef.current = key;
    if (!key) {
      setState(emptyPaged<T>(false));
      return;
    }
    let alive = true;
    setState(emptyPaged<T>(true));
    fnRef
      .current(null)
      .then((page) => {
        if (alive) setState({ items: page.items, next: page.next, loading: false, loadingMore: false, error: null });
      })
      .catch((e) => {
        if (alive) setState({ ...emptyPaged<T>(false), error: errorText(e) });
      });
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    const k = keyRef.current;
    if (!k || !s.next || s.loadingMore) return;
    setState({ ...s, loadingMore: true });
    try {
      const page = await fnRef.current(s.next);
      if (keyRef.current !== k) return;
      setState((cur) => ({ ...cur, items: [...cur.items, ...page.items], next: page.next, loadingMore: false }));
    } catch (e) {
      if (keyRef.current !== k) return;
      setState((cur) => ({ ...cur, loadingMore: false }));
      toast(errorText(e), 'error');
    }
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, loadMore, reload };
}
