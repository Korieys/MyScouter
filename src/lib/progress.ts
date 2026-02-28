// Shared in-memory progress tracking for scout jobs
// In production, this would use Redis or similar

export interface ProgressEvent {
    step: string;
    detail: string;
    progress: number; // 0-100
    timestamp: number;
}

const jobProgress = new Map<string, ProgressEvent[]>();
const jobListeners = new Map<string, Set<(event: ProgressEvent) => void>>();

export function emitProgress(jobId: string, step: string, detail: string, progress: number) {
    const event: ProgressEvent = { step, detail, progress, timestamp: Date.now() };

    if (!jobProgress.has(jobId)) {
        jobProgress.set(jobId, []);
    }
    jobProgress.get(jobId)!.push(event);

    // Notify all listeners
    const listeners = jobListeners.get(jobId);
    if (listeners) {
        listeners.forEach((cb) => cb(event));
    }
}

export function onProgress(jobId: string, callback: (event: ProgressEvent) => void): () => void {
    if (!jobListeners.has(jobId)) {
        jobListeners.set(jobId, new Set());
    }
    jobListeners.get(jobId)!.add(callback);

    // Send any existing events
    const existing = jobProgress.get(jobId);
    if (existing) {
        existing.forEach((e) => callback(e));
    }

    // Return cleanup function
    return () => {
        jobListeners.get(jobId)?.delete(callback);
        if (jobListeners.get(jobId)?.size === 0) {
            jobListeners.delete(jobId);
        }
    };
}

export function clearProgress(jobId: string) {
    jobProgress.delete(jobId);
    jobListeners.delete(jobId);
}

// UUID -> outputDir mapping (never expose filesystem paths to client)
const jobPaths = new Map<string, string>();

export function setJobPath(jobId: string, outputDir: string) {
    jobPaths.set(jobId, outputDir);
}

export function getJobPath(jobId: string): string | undefined {
    return jobPaths.get(jobId);
}
