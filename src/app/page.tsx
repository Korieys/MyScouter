"use client";

import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { useEffect, useState } from "react";

const DEMO_URLS = ["vercel.com", "stripe.com", "linear.app", "notion.so", "arc.net"];

export default function LandingPage() {
    const [demoIdx, setDemoIdx] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setDemoIdx((prev) => (prev + 1) % DEMO_URLS.length);
        }, 2400);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="animate-slide-up" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
            {/* Navbar wrapper — full bleed, sticky */}
            <div style={{ padding: "0 2rem", maxWidth: "1120px", margin: "0 auto", width: "100%" }}>
                <Navbar />
            </div>

            <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>

                {/* ─── Hero ─── */}
                <section style={{ padding: "5rem 2rem 6rem", textAlign: "center", position: "relative", overflow: "hidden" }}>
                    {/* Decorative radial glow */}
                    <div style={{
                        position: "absolute", top: "-120px", left: "50%", transform: "translateX(-50%)",
                        width: "800px", height: "600px", borderRadius: "50%",
                        background: "radial-gradient(ellipse, rgba(216,90,32,0.06) 0%, transparent 70%)",
                        pointerEvents: "none",
                    }} />

                    <div style={{ position: "relative", maxWidth: "780px", margin: "0 auto" }}>
                        <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.75rem" }}>
                            <span className="merit-badge animate-stamp">PRODUCT SCOUT</span>
                        </div>
                        <h1 className="heading-display" style={{ fontSize: "clamp(2.8rem, 6vw, 4.2rem)", marginBottom: "1.5rem", lineHeight: 1.08 }}>
                            Screenshots. Mockups.<br />
                            <span style={{ color: "var(--campfire)" }}>AI Copy. One Click.</span>
                        </h1>
                        <p style={{ fontSize: "1.2rem", color: "var(--rope)", maxWidth: "560px", margin: "0 auto 2.5rem", lineHeight: 1.65 }}>
                            Enter any website URL and MyScouter captures multi-device screenshots,
                            wraps them in polished mockups, generates marketing copy with GPT‑4o, and
                            delivers a ready‑to‑ship asset pack.
                        </p>

                        {/* Live URL ticker + CTA */}
                        <div style={{
                            display: "inline-flex", alignItems: "center", gap: "0",
                            background: "var(--canvas-white)", border: "2px solid var(--khaki)",
                            borderRadius: "var(--radius-md)", overflow: "hidden",
                            boxShadow: "var(--shadow-patch)", maxWidth: "520px", width: "100%",
                        }}>
                            <div style={{
                                flex: 1, padding: "14px 20px", display: "flex", alignItems: "center", gap: "10px",
                                fontFamily: "var(--font-mono)", fontSize: "0.95rem", color: "var(--rope)",
                                borderRight: "2px solid var(--khaki)", minWidth: 0,
                            }}>
                                <span style={{ opacity: 0.4 }}>https://</span>
                                <span key={demoIdx} className="animate-slide-up" style={{ color: "var(--forest-deep)", fontWeight: 700 }}>
                                    {DEMO_URLS[demoIdx]}
                                </span>
                            </div>
                            <Link href="/scout" style={{
                                padding: "14px 24px", background: "linear-gradient(180deg, var(--campfire-glow) 0%, var(--campfire) 100%)",
                                color: "#fff", fontFamily: "var(--font-body)", fontWeight: 700, fontSize: "0.9rem",
                                textDecoration: "none", whiteSpace: "nowrap",
                                textShadow: "0 1px 2px rgba(0,0,0,0.2)",
                            }}>
                                Start Scouting
                            </Link>
                        </div>

                        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--rope)", opacity: 0.5, marginTop: "1rem", letterSpacing: "1px" }}>
                            No credit card required · Free to use
                        </p>
                    </div>
                </section>

                {/* ─── How It Works ─── */}
                <section style={{ padding: "5rem 2rem", background: "var(--parchment)", borderTop: "1px solid var(--khaki)", borderBottom: "1px solid var(--khaki)" }}>
                    <div style={{ maxWidth: "960px", margin: "0 auto" }}>
                        <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
                            <span className="label-scout" style={{ display: "block", marginBottom: "0.75rem" }}>How It Works</span>
                            <h2 className="heading-display" style={{ fontSize: "2.5rem" }}>Three steps. Zero effort.</h2>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2rem", position: "relative" }}>
                            {/* Connector line */}
                            <div style={{
                                position: "absolute", top: "36px", left: "calc(16.67% + 24px)", right: "calc(16.67% + 24px)",
                                height: "3px", background: "repeating-linear-gradient(90deg, var(--khaki-dark) 0px, var(--khaki-dark) 8px, transparent 8px, transparent 14px)",
                                opacity: 0.4, zIndex: 0,
                            }} />

                            {[
                                { num: "1", icon: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>, title: "Paste a URL", desc: "Drop in any website address. MyScouter handles the rest." },
                                { num: "2", icon: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>, title: "Capture & Enhance", desc: "Puppeteer captures every viewport. Sharp enhances every pixel." },
                                { num: "3", icon: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>, title: "Download Pack", desc: "Get mockups, screenshots, AI copy, and a ZIP bundle — instantly." },
                            ].map((step) => (
                                <div key={step.num} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", position: "relative", zIndex: 1 }}>
                                    <div style={{
                                        width: "72px", height: "72px", borderRadius: "50%",
                                        background: "linear-gradient(135deg, var(--forest), var(--pine))",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        color: "var(--khaki-light)",
                                        fontSize: "1.8rem", marginBottom: "1.25rem",
                                        border: "3px solid var(--khaki)", boxShadow: "var(--shadow-stamp)",
                                    }}>
                                        {step.icon}
                                    </div>
                                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", fontWeight: 700, color: "var(--campfire)", textTransform: "uppercase", letterSpacing: "2px", marginBottom: "0.5rem" }}>
                                        Step {step.num}
                                    </span>
                                    <h3 className="heading-section" style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>{step.title}</h3>
                                    <p style={{ color: "var(--rope)", fontSize: "0.9rem", lineHeight: 1.5, maxWidth: "240px" }}>{step.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ─── Features ─── */}
                <section id="features" style={{ padding: "5rem 2rem" }}>
                    <div style={{ maxWidth: "1060px", margin: "0 auto" }}>
                        <div style={{ textAlign: "center", marginBottom: "4rem" }}>
                            <span className="label-scout" style={{ display: "block", marginBottom: "0.75rem" }}>Features</span>
                            <h2 className="heading-display" style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>Everything you need to launch</h2>
                            <p style={{ color: "var(--rope)", fontSize: "1.05rem", maxWidth: "500px", margin: "0 auto" }}>
                                A single URL generates a complete marketing asset pack.
                            </p>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.5rem", gridAutoRows: "minmax(200px, auto)" }}>

                            {/* Feature 1: Multi-Device Capture (Spans 2 cols) */}
                            <div className="patch-card" style={{ gridColumn: "span 2", padding: "2.5rem", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                                <div>
                                    <div style={{
                                        width: "48px", height: "48px", borderRadius: "50%", marginBottom: "1.5rem",
                                        background: "linear-gradient(135deg, var(--forest), var(--pine))",
                                        border: "2px dashed var(--khaki-light)", boxShadow: "var(--shadow-stamp)",
                                        display: "flex", alignItems: "center", justifyContent: "center", color: "var(--khaki-light)"
                                    }}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>
                                        </svg>
                                    </div>
                                    <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", color: "var(--forest-deep)", marginBottom: "0.5rem" }}>Multi-Device Capture</h3>
                                    <p style={{ color: "var(--rope)", fontSize: "0.95rem", lineHeight: 1.6, maxWidth: "400px" }}>
                                        Automatic screenshots across Desktop, Tablet, and Mobile viewports. Cookie banners are auto-dismissed for exceptionally clean shots without any manual intervention.
                                    </p>
                                </div>
                            </div>

                            {/* Feature 2: AI Copy (Spans 1 col, 2 rows) */}
                            <div className="patch-card" style={{ gridColumn: "span 1", gridRow: "span 2", padding: "2.5rem", display: "flex", flexDirection: "column", background: "linear-gradient(180deg, var(--canvas-white) 0%, var(--parchment) 100%)" }}>
                                <div style={{
                                    width: "48px", height: "48px", borderRadius: "50%", marginBottom: "1.5rem",
                                    background: "linear-gradient(135deg, var(--campfire), var(--ember))",
                                    border: "2px dashed var(--khaki-light)", boxShadow: "var(--shadow-stamp)",
                                    display: "flex", alignItems: "center", justifyContent: "center", color: "var(--khaki-light)"
                                }}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                                    </svg>
                                </div>
                                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", color: "var(--forest-deep)", marginBottom: "0.5rem" }}>AI-Powered Copy</h3>
                                <p style={{ color: "var(--rope)", fontSize: "0.95rem", lineHeight: 1.6, flex: 1 }}>
                                    GPT‑4o reads your site content directly from the DOM and writes a high-converting elevator pitch, exact feature blurbs, an engaging launch tweet, and a catchy tagline perfectly tailored for you.
                                    <br /><br />
                                    Never stare at a blank page again when preparing for your upcoming product launch or update.
                                </p>
                            </div>

                            {/* Feature 3: Browser Mockups (Spans 1 col) */}
                            <div className="patch-card" style={{ padding: "2rem", display: "flex", flexDirection: "column" }}>
                                <div style={{
                                    width: "48px", height: "48px", borderRadius: "50%", marginBottom: "1.25rem",
                                    background: "linear-gradient(135deg, var(--rope), var(--wood-brown))",
                                    border: "2px dashed var(--parchment)", boxShadow: "var(--shadow-stamp)",
                                    display: "flex", alignItems: "center", justifyContent: "center", color: "var(--canvas-white)"
                                }}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line>
                                    </svg>
                                </div>
                                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem", color: "var(--forest-deep)", marginBottom: "0.4rem" }}>Browser Mockups</h3>
                                <p style={{ color: "var(--rope)", fontSize: "0.9rem", lineHeight: 1.55 }}>
                                    Every screenshot is wrapped in a polished macOS Safari-style browser frame.
                                </p>
                            </div>

                            {/* Feature 4: Brand Colors (Spans 1 col) */}
                            <div className="patch-card" style={{ padding: "2rem", display: "flex", flexDirection: "column" }}>
                                <div style={{
                                    width: "48px", height: "48px", borderRadius: "50%", marginBottom: "1.25rem",
                                    background: "linear-gradient(135deg, var(--khaki-dark), var(--rope))",
                                    border: "2px dashed var(--parchment)", boxShadow: "var(--shadow-stamp)",
                                    display: "flex", alignItems: "center", justifyContent: "center", color: "var(--canvas-white)"
                                }}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="13.5" cy="6.5" r=".5"></circle><circle cx="17.5" cy="10.5" r=".5"></circle><circle cx="8.5" cy="7.5" r=".5"></circle><circle cx="6.5" cy="12.5" r=".5"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>
                                    </svg>
                                </div>
                                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem", color: "var(--forest-deep)", marginBottom: "0.4rem" }}>Auto Brand Detection</h3>
                                <p style={{ color: "var(--rope)", fontSize: "0.9rem", lineHeight: 1.55 }}>
                                    Extracts your dominant brand color to keep every asset beautifully on-brand automatically.
                                </p>
                            </div>

                            {/* Feature 5: Cloud Persistence (Spans 2 cols) */}
                            <div className="patch-card" style={{ gridColumn: "span 2", padding: "2.5rem", display: "flex", alignItems: "center", gap: "2rem" }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{
                                        width: "48px", height: "48px", borderRadius: "50%", marginBottom: "1.25rem",
                                        background: "linear-gradient(135deg, var(--pine), var(--forest-deep))",
                                        border: "2px dashed var(--khaki-light)", boxShadow: "var(--shadow-stamp)",
                                        display: "flex", alignItems: "center", justifyContent: "center", color: "var(--khaki-light)"
                                    }}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path>
                                        </svg>
                                    </div>
                                    <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", color: "var(--forest-deep)", marginBottom: "0.5rem" }}>Cloud Persistence</h3>
                                    <p style={{ color: "var(--rope)", fontSize: "0.95rem", lineHeight: 1.6, maxWidth: "420px" }}>
                                        All assets and scout history are securely stored in the cloud. Access your Dashboard anytime to view previous deployments and re-download your high-res image sets.
                                    </p>
                                </div>
                            </div>

                            {/* Feature 6: ZIP Bundle (Spans 1 col) */}
                            <div className="patch-card" style={{ padding: "2.5rem", display: "flex", flexDirection: "column" }}>
                                <div style={{
                                    width: "48px", height: "48px", borderRadius: "50%", marginBottom: "1.25rem",
                                    background: "linear-gradient(135deg, var(--campfire-glow), var(--campfire))",
                                    border: "2px dashed var(--parchment)", boxShadow: "var(--shadow-stamp)",
                                    display: "flex", alignItems: "center", justifyContent: "center", color: "var(--canvas-white)"
                                }}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>
                                    </svg>
                                </div>
                                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", color: "var(--forest-deep)", marginBottom: "0.5rem" }}>Organized ZIP Bundle</h3>
                                <p style={{ color: "var(--rope)", fontSize: "0.95rem", lineHeight: 1.6 }}>
                                    Download everything as a single logically organized ZIP file.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ─── Stats / Social Proof ─── */}
                <section style={{
                    padding: "4rem 2rem",
                    background: "linear-gradient(135deg, var(--forest-deep) 0%, var(--forest) 100%)",
                    color: "var(--canvas-white)",
                }}>
                    <div style={{ maxWidth: "900px", margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "2rem", textAlign: "center" }}>
                        {[
                            { value: "20+", label: "Cookie Selectors" },
                            { value: "3", label: "Device Viewports" },
                            { value: "GPT‑4o", label: "AI Engine" },
                            { value: "< 60s", label: "Per Scout" },
                        ].map((stat) => (
                            <div key={stat.label}>
                                <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", color: "var(--campfire-glow)", marginBottom: "0.25rem" }}>{stat.value}</div>
                                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "2px", color: "var(--khaki)", opacity: 0.8 }}>{stat.label}</div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ─── Tech Stack ─── */}
                <section style={{ padding: "4rem 2rem", borderTop: "1px solid var(--khaki)" }}>
                    <div style={{ maxWidth: "700px", margin: "0 auto", textAlign: "center" }}>
                        <span className="label-scout" style={{ display: "block", marginBottom: "0.75rem" }}>Built With</span>
                        <div style={{ display: "flex", justifyContent: "center", gap: "2.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
                            {["Next.js", "Puppeteer", "Sharp", "OpenAI", "Firebase", "TypeScript"].map((tech) => (
                                <span key={tech} style={{
                                    fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 700,
                                    color: "var(--rope)", padding: "8px 16px",
                                    background: "var(--parchment)", borderRadius: "999px",
                                    border: "1px solid var(--khaki)",
                                }}>
                                    {tech}
                                </span>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ─── Final CTA ─── */}
                <section style={{
                    padding: "5rem 2rem", textAlign: "center",
                    background: "var(--parchment)", borderTop: "1px solid var(--khaki)",
                    position: "relative", overflow: "hidden",
                }}>
                    {/* Decorative glow */}
                    <div style={{
                        position: "absolute", bottom: "-80px", left: "50%", transform: "translateX(-50%)",
                        width: "600px", height: "400px", borderRadius: "50%",
                        background: "radial-gradient(ellipse, rgba(216,90,32,0.06) 0%, transparent 70%)",
                        pointerEvents: "none",
                    }} />

                    <div style={{ position: "relative" }}>
                        <h2 className="heading-display" style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>
                            Ready to deploy your scout?
                        </h2>
                        <p style={{ color: "var(--rope)", fontSize: "1.05rem", marginBottom: "2.5rem", maxWidth: "440px", margin: "0 auto 2.5rem" }}>
                            Stop manually screenshotting websites. Let MyScouter do the heavy lifting.
                        </p>
                        <Link href="/scout" className="btn-campfire" style={{ padding: "18px 40px", fontSize: "1.1rem", textDecoration: "none" }}>
                            Start Scouting — It&apos;s Free
                        </Link>
                    </div>
                </section>

                {/* ─── Footer ─── */}
                <footer style={{
                    padding: "2rem", textAlign: "center",
                    borderTop: "1px solid var(--khaki)",
                    fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--rope)", opacity: 0.6,
                    letterSpacing: "1px",
                }}>
                    MyScouter · Built by Antigrav · © {new Date().getFullYear()}
                </footer>
            </main>
        </div>
    );
}
