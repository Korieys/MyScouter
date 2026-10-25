import { adminDb } from "./firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export interface ProgressEvent {
    step: string;
    detail: string;
    progress: number; // 0-100
    timestamp: number;
}

export async function emitProgress(jobId: string, step: string, detail: string, progress: number) {
    const event: ProgressEvent = { step, detail, progress, timestamp: Date.now() };

    try {
        const jobRef = adminDb.collection("scout-jobs").doc(jobId);

        // Use arrayUnion to safely append the event in a transaction-free way
        await jobRef.set({
            events: FieldValue.arrayUnion(event),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (err) {
        console.error("Failed to emit progress for job", jobId, err);
    }
}

export async function clearProgress(jobId: string) {
    try {
        await adminDb.collection("scout-jobs").doc(jobId).delete();
    } catch (err) {
        console.error("Failed to clear progress for job", jobId, err);
    }
}

// Clients may open the progress stream before the scout starts by supplying their own job id.
// Only accept ids in the shape we generate so arbitrary Firestore doc ids can't be written.
const JOB_ID_PATTERN = /^job-[A-Za-z0-9-]{8,64}$/;

export function resolveJobId(candidate: unknown, fallback: string): string {
    return typeof candidate === "string" && JOB_ID_PATTERN.test(candidate) ? candidate : fallback;
}
