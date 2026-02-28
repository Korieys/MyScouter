"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { collection, query, getDocs, where } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { Navbar } from "@/components/navbar";

interface ScoutEntry {
    id: string;
    url: string;
    domain: string;
    brandColor: string;
    status: string;
    createdAt: string;
    devices: string[];
    pages: { url: string; title: string; screenshotCount: number; viewports: string[] }[];
}

export default function Dashboard() {
    const [scouts, setScouts] = useState<ScoutEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!authLoading) {
            if (!user) {
                router.push("/login");
            } else {
                loadScouts();
            }
        }
    }, [user, authLoading]);

    const loadScouts = async () => {
        if (!user) return;
        try {
            const q = query(
                collection(db, "scouts"),
                where("userId", "==", user.uid)
            );
            const snapshot = await getDocs(q);
            const entries: ScoutEntry[] = [];
            snapshot.forEach((doc) => {
                entries.push(doc.data() as ScoutEntry);
            });

            // Sort locally to avoid Firebase composite index requirement
            entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setScouts(entries.slice(0, 20));
        } catch (err) {
            console.error("Failed to load scouts:", err);
        } finally {
            setLoading(false);
        }
    };

    const formatTime = (iso: string) => {
        const diff = Date.now() - new Date(iso).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return "Just now";
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    const isDataLoading = authLoading || loading || !user;

    return (
        <div style={{ padding: "3rem 2rem", maxWidth: "1000px", margin: "0 auto" }}>
            {/* Nav */}
            <Navbar />

            {/* This wrapper ensures the slide-up animation happens EXACTLY once on initial page load, and data seamlessly fades/swaps inside it without a second animation jump. */}
            <div className="animate-slide-up" style={{ animationDelay: "0.1s", animationFillMode: "both" }}>
                <hr className="rope-divider" />

                <main style={{ display: "grid", gridTemplateColumns: "minmax(200px, 280px) 1fr", gap: "3rem", marginTop: "2rem" }}>
                    {isDataLoading ? (
                        <>
                            {/* Loading Sidebar Structure */}
                            <div>
                                <div className="skeleton" style={{ width: "160px", height: "28px", borderRadius: "6px", marginBottom: "1.25rem" }} />
                                <div className="patch-card skeleton" style={{ padding: "2rem", height: "200px" }} />
                            </div>

                            {/* Loading Scout History Structure */}
                            <div>
                                <div className="skeleton" style={{ width: "180px", height: "28px", borderRadius: "6px", marginBottom: "1.25rem" }} />
                                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                                    {[1, 2, 3].map((i) => (
                                        <div key={i} className="patch-card skeleton" style={{ padding: "1.5rem 2rem", height: "100px" }} />
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Real Sidebar */}
                            <div>
                                <h2 className="heading-section" style={{ marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "8px" }}>Account Settings</h2>
                                <div className="patch-card" style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
                                    <div>
                                        <label className="label-scout" style={{ display: "block", marginBottom: "0.5rem" }}>Default Accent Color</label>
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "var(--parchment)", padding: "10px", borderRadius: "var(--radius-md)", border: "2px solid var(--khaki)" }}>
                                            <div style={{ width: "24px", height: "24px", background: "var(--forest)", borderRadius: "4px", border: "1px solid var(--forest-deep)" }}></div>
                                            <span style={{ fontFamily: "var(--font-mono)", color: "var(--rope)", fontSize: "0.85rem" }}>#2D4A22</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="label-scout" style={{ display: "block", marginBottom: "0.5rem" }}>Total Scouts</label>
                                        <p style={{ fontFamily: "var(--font-display)", fontSize: "2rem", color: "var(--forest-deep)" }}>{scouts.length}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Real Scout Log */}
                            <div>
                                <h2 className="heading-section" style={{ marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "8px" }}>📋 Scout History</h2>
                                {scouts.length === 0 ? (
                                    <div className="patch-card" style={{ padding: "3rem 2rem", textAlign: "center" }}>
                                        <p style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", color: "var(--rope)", marginBottom: "1rem" }}>No scouts yet</p>
                                        <Link href="/" className="btn-campfire" style={{ textDecoration: "none", display: "inline-block" }}>Send Your First Scout</Link>
                                    </div>
                                ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                                        {scouts.map((scout) => (
                                            <div key={scout.id} className="patch-card" style={{ padding: "1.5rem 2rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
                                                <div>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.35rem" }}>
                                                        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem", color: "var(--forest-deep)" }}>{scout.domain}</h3>
                                                        <span className="merit-badge" style={{ fontSize: "0.65rem" }}>✓ {scout.status}</span>
                                                    </div>
                                                    <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--rope)" }}>
                                                        Scouted {formatTime(scout.createdAt)} · {scout.devices?.join(", ") || "Desktop"} · {scout.pages?.length || 1} page{(scout.pages?.length || 1) !== 1 ? "s" : ""}
                                                    </p>
                                                </div>
                                                <div style={{ display: "flex", gap: "0.75rem" }}>
                                                    <Link href={`/preview/${scout.id}`} className="btn-scout" style={{ padding: "8px 16px", fontSize: "0.8rem", textDecoration: "none" }}>
                                                        View Pack
                                                    </Link>
                                                    <Link href={`/?url=${encodeURIComponent(scout.url)}`} className="btn-outline" style={{ padding: "8px 16px", fontSize: "0.8rem", textDecoration: "none" }}>
                                                        Re-Scout
                                                    </Link>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </main>
            </div>
        </div>
    );
}
