"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { ScoutTrail } from "@/components/scout-trail";
import { useAuth } from "@/lib/auth-context";

interface ProgressEvent {
  step: string;
  detail: string;
  progress: number;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const { user } = useAuth();
  const router = useRouter();
  const [color, setColor] = useState("#2D4A22");
  const [devices, setDevices] = useState({ desktop: true, tablet: false, mobile: false });
  const [isScouting, setIsScouting] = useState(false);
  const [autoColor, setAutoColor] = useState(false);
  const [authMode, setAuthMode] = useState<"none" | "basic" | "advanced">("none");
  const [loginUrl, setLoginUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const handleDeviceChange = (device: keyof typeof devices) => {
    setDevices((prev) => ({ ...prev, [device]: !prev[device] }));
  };

  const handleScout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    if (!user) {
      router.push("/login");
      return;
    }

    const formattedUrl = url.startsWith("http://") || url.startsWith("https://")
      ? url
      : `https://${url}`;

    setIsScouting(true);
    setError("");
    setProgress({ step: "init", detail: "Starting scout...", progress: 0 });

    // Progress only ever moves forward; the client's own milestones and the server's
    // stream can arrive out of order. The client announces "done" itself after copy.
    const advance = (event: ProgressEvent) =>
      setProgress((prev) => (prev && event.progress < prev.progress ? prev : event));

    // Open the progress stream before scouting so the long capture phase is visible.
    const jobId = `job-${crypto.randomUUID()}`;
    const es = new EventSource(`/api/scout/progress?jobId=${jobId}`);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const event: ProgressEvent = JSON.parse(e.data);
        if (event.step !== "done" && event.progress >= 0) advance(event);
      } catch { /* ignore */ }
    };

    try {
      // Step 1: Scout
      const selectedDevices = Object.entries(devices).filter(([, v]) => v).map(([k]) => k);

      const scoutRes = await fetch("/api/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: formattedUrl,
          brandColor: color,
          devices: selectedDevices.length ? selectedDevices : ["desktop"],
          autoDetectColor: autoColor,
          jobId,
          ...(authMode !== "none" && loginUrl && username ? {
            auth: {
              mode: authMode,
              loginUrl: loginUrl.startsWith("http") ? loginUrl : `https://${loginUrl}`,
              username,
              password,
            },
          } : {}),
        }),
      });

      if (!scoutRes.ok) {
        const err = await scoutRes.json();
        throw new Error(err.error || "Scout failed");
      }

      const scoutData = await scoutRes.json();

      // Step 2: Enhance
      advance({ step: "enhance", detail: "Enhancing screenshots...", progress: 72 });

      const enhanceRes = await fetch("/api/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scoutId: scoutData.id,
          jobId,
          brandColor: scoutData.brandColor,
          pages: scoutData.pages,
        }),
      });

      if (!enhanceRes.ok) {
        const err = await enhanceRes.json();
        throw new Error(err.error || "Enhancement failed");
      }

      const enhanceData = await enhanceRes.json();

      // Step 3: AI Copy
      advance({ step: "copy", detail: "Writing marketing copy...", progress: 95 });

      let copyData = null;
      try {
        const copyRes = await fetch("/api/copy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            textContent: scoutData.textContent,
            domain: scoutData.domain,
            pageTitle: scoutData.pages[0]?.title || "",
          }),
        });
        if (copyRes.ok) {
          copyData = await copyRes.json();
        }
      } catch {
        // Non-fatal — copy generation is optional
      }

      // Store results
      const result = {
        ...scoutData,
        enhancedAssets: enhanceData.assets,
        copy: copyData,
        scoutId: scoutData.id,
      };
      localStorage.setItem("myscouter-latest", JSON.stringify(result));
      localStorage.setItem(`myscouter-${scoutData.id}`, JSON.stringify(result));

      setProgress({ step: "done", detail: "Scout complete! Heading back to camp...", progress: 100 });

      es.close();
      eventSourceRef.current = null;

      // Navigate after a brief moment so the summit celebration is visible
      setTimeout(() => {
        window.location.href = `/preview/${scoutData.id}`;
      }, 1400);

    } catch (err) {
      console.error("Scout pipeline error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setProgress(null);
      setIsScouting(false);
      eventSourceRef.current?.close();
    }
  };

  const domain = url.replace(/^https?:\/\//, "").split("/")[0];

  return (
    <div style={{ padding: "3rem 2rem", maxWidth: "880px", margin: "0 auto", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* Nav */}
      <Navbar />

      {/* Hero */}
      <main className="animate-slide-up" style={{ flex: 1, display: "flex", flexDirection: "column", gap: "3rem" }}>
        <div style={{ textAlign: "center", maxWidth: "680px", margin: "0 auto" }}>
          <h2 className="heading-display" style={{ marginBottom: "0.5rem", fontSize: "2rem" }}>
            New Scout
          </h2>
          <p style={{ fontSize: "1.05rem", color: "var(--rope)" }}>
            Enter a target URL below to dispatch a scout.
          </p>
        </div>

        {/* Input Form */}
        <div className="patch-card" style={{ padding: "2.5rem", maxWidth: "620px", margin: "0 auto", width: "100%" }}>
          <div style={{ position: "absolute", top: "12px", left: "20px", right: "20px", height: "1px", background: "repeating-linear-gradient(90deg, var(--khaki) 0px, var(--khaki) 6px, transparent 6px, transparent 10px)", opacity: 0.4 }}></div>

          <form onSubmit={handleScout} style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
            <div>
              <label className="label-scout" style={{ display: "block", marginBottom: "0.5rem" }}>Target Coordinates</label>
              <input type="text" placeholder="tailoroutreach.com" required className="input-scout" value={url} onChange={(e) => setUrl(e.target.value)} disabled={isScouting} />
            </div>

            {/* Authentication Mode */}
            <div>
              <label className="label-scout" style={{ display: "block", marginBottom: "0.5rem" }}>Authentication</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {([
                  { key: "none", label: "None" },
                  { key: "basic", label: "Basic" },
                  { key: "advanced", label: "Advanced (AI)" },
                ] as const).map(({ key, label }) => {
                  const isActive = authMode === key;
                  return (
                    <button type="button" key={key} onClick={() => setAuthMode(key)} disabled={isScouting}
                      style={{
                        flex: 1, padding: "10px 0", borderRadius: "var(--radius-md)",
                        border: `2px solid ${isActive ? "var(--forest)" : "var(--khaki)"}`,
                        background: isActive ? "var(--forest)" : "var(--canvas-white)",
                        color: isActive ? "var(--khaki-light)" : "var(--rope)",
                        fontFamily: "var(--font-mono)", fontWeight: 700, cursor: isScouting ? "not-allowed" : "pointer",
                        transition: "all 0.2s", fontSize: "0.8rem",
                        boxShadow: isActive ? "var(--shadow-emboss)" : "none",
                        opacity: isScouting ? 0.6 : 1,
                      }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Credential Inputs */}
            {authMode !== "none" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1rem", background: "var(--parchment)", borderRadius: "var(--radius-md)", border: "2px dashed var(--khaki)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "0.25rem" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--forest)", fontWeight: 700 }}>
                    {authMode === "advanced" ? "🤖 AI-ASSISTED LOGIN" : "🔑 BASIC LOGIN"}
                  </span>
                </div>
                <div>
                  <label className="label-scout" style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.8rem" }}>Login URL</label>
                  <input type="text" placeholder="app.example.com/login" className="input-scout" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} disabled={isScouting} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label className="label-scout" style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.8rem" }}>Username / Email</label>
                    <input type="text" placeholder="user@example.com" className="input-scout" value={username} onChange={(e) => setUsername(e.target.value)} disabled={isScouting} />
                  </div>
                  <div>
                    <label className="label-scout" style={{ display: "block", marginBottom: "0.35rem", fontSize: "0.8rem" }}>Password</label>
                    <input type="password" placeholder="••••••••" className="input-scout" value={password} onChange={(e) => setPassword(e.target.value)} disabled={isScouting} />
                  </div>
                </div>
                {authMode === "advanced" && (
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--rope)", margin: 0 }}>
                    AI will analyze the login page and autonomously navigate complex login flows.
                  </p>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1.5rem" }}>
              <div>
                <label className="label-scout" style={{ display: "block", marginBottom: "0.5rem" }}>Trail Marker</label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "var(--parchment)", padding: "10px 12px", borderRadius: "var(--radius-md)", border: "2px solid var(--khaki)", opacity: autoColor ? 0.5 : 1 }}>
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={autoColor || isScouting} style={{ width: "28px", height: "28px", padding: 0, border: "none", borderRadius: "4px", background: "transparent", cursor: autoColor ? "not-allowed" : "pointer" }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "var(--rope)" }}>{autoColor ? "Auto" : color}</span>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--rope)", cursor: "pointer" }}>
                  <input type="checkbox" checked={autoColor} onChange={(e) => setAutoColor(e.target.checked)} disabled={isScouting} style={{ accentColor: "var(--forest)" }} />
                  Auto-detect
                </label>
              </div>

              <div>
                <label className="label-scout" style={{ display: "block", marginBottom: "0.5rem" }}>Terrain</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {[
                    { key: "desktop", icon: "•" },
                    { key: "tablet", icon: "📱" },
                    { key: "mobile", icon: "📲" },
                  ].map(({ key, icon }) => {
                    const isActive = devices[key as keyof typeof devices];
                    return (
                      <button type="button" key={key} onClick={() => handleDeviceChange(key as keyof typeof devices)} disabled={isScouting}
                        style={{
                          flex: 1, padding: "10px 0", borderRadius: "var(--radius-md)",
                          border: `2px solid ${isActive ? "var(--forest)" : "var(--khaki)"}`,
                          background: isActive ? "var(--forest)" : "var(--canvas-white)",
                          color: isActive ? "var(--khaki-light)" : "var(--rope)",
                          fontFamily: "var(--font-mono)", fontWeight: 700, cursor: isScouting ? "not-allowed" : "pointer",
                          transition: "all 0.2s", fontSize: "0.85rem",
                          boxShadow: isActive ? "var(--shadow-emboss)" : "none", textTransform: "capitalize",
                          opacity: isScouting ? 0.6 : 1,
                        }}>
                        {icon} {key}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <hr className="rope-divider" style={{ margin: "0.5rem 0" }} />

            {progress && (
              <ScoutTrail step={progress.step} detail={progress.detail} progress={progress.progress} domain={domain} />
            )}

            <button type="submit" className="btn-campfire" style={{ width: "100%", padding: "16px", fontSize: "1rem" }} disabled={isScouting}>
              {isScouting ? "Scout is on the trail..." : "Send Scout"}
            </button>

            {error && (
              <p style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "var(--ember)" }}>
                {error}
              </p>
            )}
          </form>
        </div>


      </main>
    </div>
  );
}
