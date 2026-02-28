"use client";

import { useState } from "react";
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Navbar } from "@/components/navbar";

export default function Login() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleGoogleSignIn = async () => {
        try {
            setError("");
            setLoading(true);
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            window.location.href = "/dashboard";
        } catch (err: any) {
            setError(err.message || "Failed to sign in with Google");
        } finally {
            setLoading(false);
        }
    };

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setError("");
            setLoading(true);
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
            window.location.href = "/dashboard";
        } catch (err: any) {
            setError(err.message || `Failed to ${isLogin ? "sign in" : "sign up"}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="animate-slide-up" style={{ padding: "3rem 2rem", maxWidth: "880px", margin: "0 auto", minHeight: "100vh" }}>
            <Navbar />

            <main style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
                <div className="patch-card" style={{ padding: "3rem 2.5rem", maxWidth: "440px", width: "100%" }}>
                    <div style={{ textAlign: "center", marginBottom: "2rem" }}>
                        <span className="merit-badge animate-stamp" style={{ marginBottom: "1rem" }}>
                            {isLogin ? "Access Camp" : "Join the Troop"}
                        </span>
                        <h2 className="heading-display" style={{ fontSize: "2rem" }}>
                            {isLogin ? "Welcome Back" : "Start Scouting"}
                        </h2>
                    </div>

                    <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                        <div>
                            <label className="label-scout" style={{ display: "block", marginBottom: "0.5rem" }}>Email</label>
                            <input
                                type="email"
                                required
                                className="input-scout"
                                placeholder="scout@trail.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={loading}
                            />
                        </div>
                        <div>
                            <label className="label-scout" style={{ display: "block", marginBottom: "0.5rem" }}>Password</label>
                            <input
                                type="password"
                                required
                                className="input-scout"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={loading}
                            />
                        </div>

                        {error && (
                            <p style={{ color: "var(--ember)", fontSize: "0.85rem", fontFamily: "var(--font-mono)", textAlign: "center" }}>
                                {error}
                            </p>
                        )}

                        <button type="submit" className="btn-scout" style={{ width: "100%", marginTop: "0.5rem" }} disabled={loading}>
                            {loading ? "Processing..." : (isLogin ? "Sign In" : "Sign Up")}
                        </button>
                    </form>

                    <div style={{ display: "flex", alignItems: "center", gap: "1rem", margin: "2rem 0" }}>
                        <div style={{ flex: 1, height: "1px", background: "var(--khaki)", opacity: 0.5 }} />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--rope)" }}>OR</span>
                        <div style={{ flex: 1, height: "1px", background: "var(--khaki)", opacity: 0.5 }} />
                    </div>

                    <button
                        onClick={handleGoogleSignIn}
                        type="button"
                        className="btn-outline"
                        style={{ width: "100%", display: "flex", justifyContent: "center", gap: "10px", background: "var(--canvas-white)" }}
                        disabled={loading}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Continue with Google
                    </button>

                    <p style={{ textAlign: "center", marginTop: "2rem", fontFamily: "var(--font-body)", fontSize: "0.9rem", color: "var(--charcoal)" }}>
                        {isLogin ? "Don't have a pack yet?" : "Already part of the troop?"}{" "}
                        <button
                            onClick={() => setIsLogin(!isLogin)}
                            style={{ background: "none", border: "none", color: "var(--campfire)", fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0, fontFamily: "inherit" }}
                        >
                            {isLogin ? "Sign Up" : "Sign In"}
                        </button>
                    </p>
                </div>
            </main>
        </div>
    );
}
