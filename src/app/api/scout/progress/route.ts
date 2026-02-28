import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) {
        return new Response("Missing jobId", { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            let processedEventCount = 0;

            const unsubscribe = adminDb.collection("scout-jobs").doc(jobId)
                .onSnapshot((docSnapshot) => {
                    if (docSnapshot.exists) {
                        const data = docSnapshot.data();
                        if (data && data.events && Array.isArray(data.events)) {
                            // Only send new events
                            const newEvents = data.events.slice(processedEventCount);

                            newEvents.forEach(event => {
                                const payload = `data: ${JSON.stringify(event)}\n\n`;
                                try {
                                    controller.enqueue(encoder.encode(payload));
                                } catch {
                                    // Stream closed
                                }
                            });

                            processedEventCount = data.events.length;
                        }
                    }
                }, (error) => {
                    console.error("Firestore snapshot error:", error);
                });

            // Clean up when the client disconnects
            req.signal.addEventListener("abort", () => {
                unsubscribe();
                try {
                    controller.close();
                } catch {
                    // Already closed
                }
            });

            // Auto-close after 5 minutes
            setTimeout(() => {
                unsubscribe();
                try {
                    controller.close();
                } catch {
                    // Already closed
                }
            }, 300000);
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
