import { useCallback, useEffect, useRef, useState } from 'react';

export async function request(path, { method = 'GET', body, signal } = {}) {
    const response = await fetch(`/api${path}`, {
        method,
        signal,
        credentials: 'same-origin',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || !Object.hasOwn(result, 'data')) {
        const error = new Error(result?.error?.message ?? 'QueueWise could not reach the service. Try again.');
        error.code = result?.error?.code;
        if (error.code === 'UNAUTHENTICATED') {
            window.dispatchEvent(new Event('queuewise:session-ended'));
        }
        throw error;
    }
    return result.data;
}

export function useQuery(path, { interval = 0 } = {}) {
    const [state, setState] = useState({ path: null, data: null, error: null, loading: false });
    const pending = useRef(null);

    const refresh = useCallback(async () => {
        if (!path) return;
        pending.current?.abort();
        const controller = new AbortController();
        pending.current = controller;

        setState((previous) => ({
            path,
            data: previous.path === path ? previous.data : null,
            error: null,
            loading: previous.path !== path || previous.data === null,
        }));
        try {
            const data = await request(path, { signal: controller.signal });
            if (!controller.signal.aborted) setState({ path, data, error: null, loading: false });
        } catch (error) {
            if (!controller.signal.aborted) {
                setState((previous) => ({ ...previous, error, loading: false }));
            }
        } finally {
            if (pending.current === controller) pending.current = null;
        }
    }, [path]);

    useEffect(() => {
        void refresh();
        function refreshVisible() {
            if (!document.hidden && !pending.current) void refresh();
        }
        const timer = interval && path ? window.setInterval(refreshVisible, interval) : null;
        if (timer !== null) document.addEventListener('visibilitychange', refreshVisible);
        return () => {
            pending.current?.abort();
            if (timer !== null) {
                window.clearInterval(timer);
                document.removeEventListener('visibilitychange', refreshVisible);
            }
        };
    }, [interval, path, refresh]);

    if (state.path !== path) return { data: null, error: null, loading: Boolean(path), refresh };
    return { ...state, refresh };
}
