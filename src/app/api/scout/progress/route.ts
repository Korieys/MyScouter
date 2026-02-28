import { NextRequest } from "next/server";
import { onProgress } from "@/lib/progress";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) {
        return new Response("Missing jobId", { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            const cleanup = onProgress(jobId, (event) => {
                const data = `data: ${JSON.stringify(event)}\n\n`;
                try {
                    controller.enqueue(encoder.encode(data));
                } catch {
                    // Stream closed
                }
            });

            // Clean up when the client disconnects
            req.signal.addEventListener("abort", () => {
                cleanup();
                try {
                    controller.close();
                } catch {
                    // Already closed
                }
            });

            // Auto-close after 5 minutes
            setTimeout(() => {
                cleanup();
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
