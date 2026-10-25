export type WorkKind = 'capture' | 'enhance' | 'copy';
export const WORK_LIMITS = {
    capture: { accountDaily: 10, globalDaily: 100, globalConcurrent: 3, leaseMs: 330000 },
    enhance: { accountDaily: 30, globalDaily: 300, globalConcurrent: 6, leaseMs: 150000 },
    copy: { accountDaily: 30, globalDaily: 300, globalConcurrent: 12, leaseMs: 90000 },
} satisfies Record<WorkKind, {accountDaily:number; globalDaily:number; globalConcurrent:number; leaseMs:number}>;

export function secondsUntilReset(now: number) {
    const date = new Date(now);
    return Math.max(1, Math.ceil((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) - now) / 1000));
}
