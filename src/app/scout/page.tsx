"use client";

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {User} from 'firebase/auth';
import { useAuth } from '@/lib/auth-context';
import { runScout, type ScoutProgress } from '@/lib/run-scout';
import {ScoutTrail} from '@/components/scout-trail';
import { WORK_LIMITS } from '@/lib/work-policy';
import Link from "next/link";
import { Navbar } from "@/components/navbar";

export default function Home() {
  return <Suspense fallback={<p>Loading scout form…</p>}><ScoutForm /></Suspense>;
}

function ScoutForm() {
  const {user,loading}=useAuth();
  const router=useRouter();
  useEffect(()=>{if(!loading && !user)router.replace('/login?next=/scout');},[loading,user,router]);
  if(loading)return <p>Loading your account…</p>;
  if(!user)return <p><Link href="/login?next=/scout">Sign in to create and save your asset pack.</Link></p>;
  return <AuthenticatedScoutForm key={user.uid} user={user} />;
}

function AuthenticatedScoutForm({user}:{user:User}) {
  const searchParams = useSearchParams();
  const [url, setUrl] = useState(() => (searchParams.get('url') || '').slice(0, 2048));
  const [color, setColor] = useState("#2D4A22");
  const [devices, setDevices] = useState({ desktop: true, tablet: false, mobile: false });
  const [isScouting, setIsScouting] = useState(false);
  const [autoColor, setAutoColor] = useState(false);
  const [progress, setProgress] = useState<ScoutProgress | null>(null);
  const [error, setError] = useState("");
  const [loginMode,setLoginMode]=useState<'none'|'basic'|'advanced'>('none');
  const [loginUrl,setLoginUrl]=useState('');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [loginConsent,setLoginConsent]=useState(false);
  const [aiConsent,setAiConsent]=useState(false);
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>active.current?.abort(),[]);


  const handleDeviceChange = (device: keyof typeof devices) => {
    setDevices((prev) => ({ ...prev, [device]: !prev[device] }));
  };

  const handleScout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    const formattedUrl = url.startsWith("http://") || url.startsWith("https://")
      ? url
      : `https://${url}`;

    if(active.current)return;
    const controller=new AbortController();
    active.current=controller;
    setIsScouting(true);
    setError('');
    setProgress(null);
    const selectedDevices=Object.entries(devices).filter(([,value])=>value).map(([key])=>key);
    const login=loginMode==='none'?undefined:{mode:loginMode,url:loginUrl,username,password,consent:loginConsent,aiConsent};
    setPassword('');
    try {
      const id=await runScout(user,{url:formattedUrl,brandColor:color,devices:selectedDevices.length?selectedDevices:['desktop'],autoDetectColor:autoColor,login},setProgress,controller.signal);
      controller.signal.throwIfAborted();
      window.location.href='/preview/'+id;
      // Keep the form disabled until navigation; no second request can race it.
    } catch(err) {
      if(controller.signal.aborted)return;
      setError(err instanceof Error?err.message:'The capture could not finish. Please try again.');
      setProgress(null);
      setIsScouting(false);
      active.current=null;
    }
  };

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
            Capture a website you own or have permission to use. Long pages are limited to the first 12,000 pixels.
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

            <fieldset disabled={isScouting} style={{border:0,padding:0,display:'grid',gap:'0.75rem'}}>
              <legend className="label-scout">Website sign-in</legend>
              <label htmlFor="login-mode">Capture access</label>
              <select id="login-mode" className="input-scout" value={loginMode} onChange={e=>{setLoginMode(e.target.value as typeof loginMode);setPassword('');setLoginConsent(false);setAiConsent(false);}}>
                <option value="none">Public page — no sign-in</option>
                <option value="basic">Basic sign-in</option>
                <option value="advanced">AI-assisted field selection</option>
              </select>
              {loginMode!=='none' && <>
                <label htmlFor="login-url">Sign-in page URL</label>
                <input id="login-url" type="url" required className="input-scout" placeholder="https://example.com/login" value={loginUrl} onChange={e=>setLoginUrl(e.target.value)} maxLength={2048}/>
                <label htmlFor="site-username">Website username or email</label>
                <input id="site-username" required className="input-scout" autoComplete="off" value={username} onChange={e=>setUsername(e.target.value)} maxLength={256}/>
                <label htmlFor="site-password">Website password</label>
                <input id="site-password" type="password" required className="input-scout" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)} maxLength={1024}/>
                <p style={{fontSize:'0.85rem'}}>Use a dedicated account with permission to capture this website. Sign-in supports native forms on the same HTTPS website, without query strings. Scripts, third-party sign-in, verification codes and CAPTCHA are unsupported. Signed-in scouts capture only the requested page, and external styles or images may be unavailable.</p>
                <p style={{fontSize:'0.85rem'}}>Credentials are used temporarily to sign in and are not sent to AI or saved as account details. Screenshots are saved privately; readable captured page text is sent to OpenAI for draft copy. Avoid pages containing sensitive information.</p>
                <label><input type="checkbox" required checked={loginConsent} onChange={e=>setLoginConsent(e.target.checked)}/> I have permission to sign in and capture this page, and agree to the captured text processing described above.</label>
                {loginMode==='advanced' && <label><input type="checkbox" required checked={aiConsent} onChange={e=>setAiConsent(e.target.checked)}/> I agree to send bounded, redacted field labels to OpenAI to identify the sign-in fields. My username and password are inserted locally after field selection.</label>}
              </>}
            </fieldset>

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

            {isScouting && progress && <ScoutTrail step={progress.step} detail={progress.detail} progress={progress.progress} domain={url.replace(/^https?:\/\//,'').split('/')[0]} />}

            <button type="submit" className="btn-campfire" style={{ width: "100%", padding: "16px", fontSize: "1rem" }} disabled={isScouting}>
              {isScouting ? (progress?.detail || "Scout is on the trail...") : "Send Scout"}
            </button>

            <p style={{fontSize:'0.85rem',color:'var(--rope)'}}>Your captures are saved privately to your account in Google Cloud. Readable website text is sent to OpenAI to prepare draft copy. Review the images and text before publishing.</p>
            <p style={{fontSize:'0.85rem',color:'var(--rope)'}}>Preview allowance: {WORK_LIMITS.capture.accountDaily} capture attempts per day, with one capture running at a time. Mockup and copy retries each allow {WORK_LIMITS.copy.accountDaily} attempts. Limits reset at midnight UTC; failed attempts count.</p>
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
