/** Deterministically ordered queries are supplied by the caller. Never silently truncate. */
export async function analyticsRows<T>(query: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: unknown;
}>, label: string): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; from < 100000; from += 1000) {
        const { data, error } = await query(from, from + 999);
        if (error)
            throw new Error(`${label} unavailable`);
        rows.push(...(data || []) as T[]);
        if (!data || data.length < 1000)
            return rows;
    }
    throw new Error("Analytics history is too large; choose a shorter range");
}
export async function analyticsBatches<T>(ids: string[], query: (ids: string[], from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: unknown;
}>, label: string) {
    const rows: T[] = [];
    for (let start = 0; start < ids.length; start += 100) {
        const batch = ids.slice(start, start + 100);
        rows.push(...await analyticsRows<T>((from, to) => query(batch, from, to), label));
    }
    return rows;
}
