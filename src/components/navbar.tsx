"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";

export function Navbar() {
    const { user, loading } = useAuth();
    const pathname = usePathname();

    const handleSignOut = async () => {
        try {
            await signOut(auth);
            window.location.href = "/";
        } catch (err) {
            console.error("Failed to sign out:", err);
        }
    };

    return (
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4rem", flexWrap: "wrap", gap: "1rem" }}>
            <Link href="/" style={{ textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "var(--forest)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--forest-deep)", boxShadow: "var(--shadow-emboss)" }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--khaki-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="var(--campfire)" />
                        </svg>
                    </div>
                    <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--forest-deep)", letterSpacing: "-0.5px" }}>MyScouter</h1>
                </div>
            </Link>

            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                {!loading && (
                    user ? (
                        <>
                            <Link href="/scout" className={pathname === "/scout" ? "btn-scout" : "btn-outline"} style={{ textDecoration: "none", padding: "10px 20px", fontSize: "0.85rem" }}>Scout</Link>
                            <Link href="/dashboard" className={pathname === "/dashboard" ? "btn-scout" : "btn-outline"} style={{ textDecoration: "none", padding: "10px 20px", fontSize: "0.85rem" }}>Dashboard</Link>
                            <button onClick={handleSignOut} className="btn-outline" style={{ borderStyle: "dashed", padding: "10px 20px", fontSize: "0.85rem" }}>Sign Out</button>
                        </>
                    ) : (
                        <>
                            <Link href="/scout" className={pathname === "/scout" ? "btn-scout" : "btn-outline"} style={{ textDecoration: "none", padding: "10px 20px", fontSize: "0.85rem" }}>Try it out</Link>
                            <Link href="/login" className={pathname === "/login" ? "btn-scout" : "btn-outline"} style={{ textDecoration: "none", padding: "10px 20px", fontSize: "0.85rem" }}>
                                Sign In / Join
                            </Link>
                        </>
                    )
                )}
            </div>
        </header>
    );
}
