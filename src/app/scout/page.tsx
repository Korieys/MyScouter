"use client";

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { authFetch, jsonResult } from '@/lib/auth-fetch';
import Link from "next/link";
import { Navbar } from "@/components/navbar";

interface ProgressEvent {
  step: string;
  detail: string;
  progress: number;
}

const STEPS = [
  { key: "init", label: "Preparing" },
  { key: "browser", label: "Launching" },
  { key: "navigate", label: "Navigating" },
  { key: "cookies", label: "Clearing" },
  { key: "text", label: "Reading" },
  { key: "links", label: "Discovering" },
  { key: "capture", label: "Capturing" },
  { key: "enhance", label: "Enhancing" },
  { key: "collage", label: "Collaging" },
  { key: "social", label: "Sizing" },
  { key: "copy", label: "Writing" },
  { key: "done", label: "Done!" },
];

export default function Home() {
  return <Suspense fallback={<p>Loading scout form…</p>}><ScoutForm /></Suspense>;
}

function ScoutForm() {
  const searchParams = useSearchParams();
  const [url, setUrl] = useState(() => (searchParams.get('url') || '').slice(0, 2048));
  const [color, setColor] = useState("#2D4A22");
  const [devices, setDevices] = useState({ desktop: true, tablet: false, mobile: false });
  const [isScouting, setIsScouting] = useState(false);
  const [autoColor, setAutoColor] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState("");
  const {user, loading:authLoading} = useAuth();


  const handleDeviceChange = (device: keyof typeof devices) => {
    setDevices((prev) => ({ ...prev, [device]: !prev[device] }));
  };

  const handleScout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    const formattedUrl = url.startsWith("http://") || url.startsWith("https://")
      ? url
      : `https://${url}`;

    setIsScouting(true);
    setError("");
    setProgress({ step: "capture", detail: "Capturing your website. This can take up to four minutes; keep this page open.", progress: 15 });

    try {
      const selectedDevices = Object.entries(devices).filter(([,v]) => v).map(([key]) => key);
      const scoutData = await jsonResult(await authFetch(user, '/api/scout', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:formattedUrl, brandColor:color, devices:selectedDevices.length ? selectedDevices : ['desktop'], autoDetectColor:autoColor}),
      }));
      setProgress({step:'enhance',detail:'Capture saved. Creating mockups...',progress:72});
      // Each stage persists its result. If optional work fails, the captured pack can still reopen.
      try {
        await jsonResult(await authFetch(user,'/api/enhance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scoutId:scoutData.id})}));
      } catch { /* The preview exposes a retry for unfinished enhancements. */ }
      setProgress({step:'copy',detail:'Writing a draft from the captured website...',progress:95});
      try {
        await jsonResult(await authFetch(user,'/api/copy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scoutId:scoutData.id})}));
      } catch { /* Copy is optional; the preview states when it is missing. */ }
      window.location.href = '/preview/' + scoutData.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The capture could not finish. Please try again.');
      setProgress(null);
    } finally {setIsScouting(false);}
  };

  const currentStepIndex = STEPS.findIndex((s) => s.key === progress?.step);

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
            Capture a public website you own or have permission to use. Long pages are limited to the first 12,000 pixels.
          </p>
        </div>

        {/* Input Form */}
        <div className="patch-card" style={{ padding: "2.5rem", maxWidth: "620px", margin: "0 auto", width: "100%" }}>
          <div style={{ position: "absolute", top: "12px", left: "20px", right: "20px", height: "1px", background: "repeating-linear-gradient(90deg, var(--khaki) 0px, var(--khaki) 6px, transparent 6px, transparent 10px)", opacity: 0.4 }}></div>

          <form onSubmit={handleScout} style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
            <div>
              <label htmlFor="scout-url" className="label-scout" style={{ display: "block", marginBottom: "0.5rem" }}>Website URL</label>
              <input id="scout-url" type="text" placeholder="example.com" required className="input-scout" value={url} onChange={(e) => setUrl(e.target.value)} disabled={isScouting} />
            </div>

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

            {/* Progress Bar */}
            {isScouting && progress && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill" style={{ width: `${Math.max(progress.progress, 3)}%` }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--forest)" }}>
                    {progress.detail}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--rope)" }}>
                    {progress.progress}%
                  </span>
                </div>
                {/* Step indicators */}
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  {STEPS.slice(0, -1).map((step, i) => (
                    <div key={step.key} style={{
                      width: "8px", height: "8px", borderRadius: "50%",
                      background: i <= currentStepIndex ? "var(--forest)" : "var(--khaki)",
                      transition: "background 0.3s",
                    }} title={step.label} />
                  ))}
                </div>
              </div>
            )}

            <button type="submit" className="btn-campfire" style={{ width: "100%", padding: "16px", fontSize: "1rem" }} disabled={isScouting || authLoading || !user}>
              {isScouting ? (progress?.detail || "Scout is on the trail...") : "Send Scout"}
            </button>

            {!authLoading && !user && <p><Link href="/login?next=/scout">Sign in to create and save your asset pack.</Link></p>}
            <p style={{fontSize:'0.85rem',color:'var(--rope)'}}>Your captures are saved privately to your account in Google Cloud. Readable website text is sent to OpenAI to prepare draft copy. Review the images and text before publishing.</p>
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
