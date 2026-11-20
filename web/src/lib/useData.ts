import { useCallback, useEffect, useState } from "react";

export function useData<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    loader().then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener("fia:refresh", h);
    return () => window.removeEventListener("fia:refresh", h);
  }, [reload]);
  return { data, error, loading, reload };
}
