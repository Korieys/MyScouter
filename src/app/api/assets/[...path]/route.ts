import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import os from "os";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const resolvedParams = await params;
        const filePath = resolvedParams.path.join("/");

        // Only allow serving from the myscouter temp directory
        const baseDir = path.join(os.tmpdir(), "myscouter");
        const fullPath = path.resolve(baseDir, filePath);

        // Security: ensure the path is within the base directory
        if (!fullPath.startsWith(baseDir)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (!fs.existsSync(fullPath)) {
            return NextResponse.json({ error: "File not found" }, { status: 404 });
        }

        const buffer = fs.readFileSync(fullPath);
        const ext = path.extname(fullPath).toLowerCase();
        const contentType = ext === ".png" ? "image/png" : "application/octet-stream";

        return new NextResponse(buffer, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch (error) {
        console.error("Serve error:", error);
        return NextResponse.json({ error: "Failed to serve file" }, { status: 500 });
    }
}
