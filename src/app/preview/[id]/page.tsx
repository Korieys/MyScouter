"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from '@/lib/auth-context';
import { authFetch, jsonResult } from '@/lib/auth-fetch';
import { auth } from '@/lib/firebase';
import { PrivateImage } from '@/components/private-image';
import { Navbar } from "@/components/navbar";

interface ScoutData {
    id: string;
    url: string;
    domain: string;
    brandColor: string;
    textContent: string;
    scoutId?: string;
    status: string;
    pages: {
        url: string;
        title: string;
        screenshots: {
            path: string;
            viewport: string;
            width: number;
            height: number;
            type: "hero" | "full" | "feature";
        }[];
    }[];
    enhancedAssets: string[];
    copy?: {
        pitch: string;
        blurbs: string[];
        twitter: string;
        tagline: string;
    };
}

function getFilename(fullPath: string): string {
    return fullPath.replace(/\\/g, "/").split("/").pop() || "";
}

export default function AssetPreview() {
    const params = useParams();
    const [data, setData] = useState<ScoutData | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState('');
    const [compareMode, setCompareMode] = useState(false);
    const {user, loading:authLoading} = useAuth();
    const [loadedFor, setLoadedFor] = useState('');
    const [loadError,setLoadError] = useState('');
    const [working,setWorking] = useState('');
    const loadKey = `${user?.uid || ''}:${String(params.id)}`;

    useEffect(() => {
        if (authLoading) return;
        if (!user) return;
        const controller = new AbortController();
        void authFetch(user, '/api/scouts/' + encodeURIComponent(String(params.id)), {signal:controller.signal})
            .then(jsonResult).then(result => {if(!controller.signal.aborted){setData(result);setLoadError('');setLoadedFor(loadKey);}})
            .catch(error => {if(!controller.signal.aborted){setData(null);setLoadError(error.message);setLoadedFor(loadKey);}});
        return () => controller.abort();
    }, [user, authLoading, params.id, loadKey]);

    const retryStage = async (stage:'enhance'|'copy') => {
        if(!data || working) return;
        setWorking(stage); setDownloadError('');
        try {
            await jsonResult(await authFetch(user,'/api/'+stage,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scoutId:data.id})}));
            const result = await jsonResult(await authFetch(user,'/api/scouts/'+encodeURIComponent(data.id)));
            setData(current => current === data ? result : current);
        } catch(error) {setDownloadError(error instanceof Error ? error.message : 'Please try again.');}
        finally {setWorking('');}
    };

    const handleDownload = async () => {
        if (!data || downloading) return;
        setDownloading(true);
        setDownloadError('');
        try {
            const res = await authFetch(user, "/api/bundle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scoutId: data.id }),
                signal: AbortSignal.timeout(60000),
            });
            if (!res.ok) {
                const failure = await res.json().catch(() => null);
                throw new Error(failure?.error || 'Download failed. Please try again.');
            }
            const blob = await res.blob();
            if (auth.currentUser?.uid !== user?.uid) return;
            if (!blob.size || !blob.type.includes('application/zip')) throw new Error('The download was incomplete. Please try again.');
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `myscouter-${data.id || data.scoutId}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => window.URL.revokeObjectURL(url), 60000);
        } catch (err) {
            setDownloadError(err instanceof Error && err.name !== 'TimeoutError' ? err.message : 'Packing took too long. Please retry the download.');
        } finally {
            setDownloading(false);
        }
    };

    const downloadIndividual = async (filename:string) => {
        if(!data) return;
        setDownloadError('');
        try {
            const response = await authFetch(user,'/api/assets/'+encodeURIComponent(data.id)+'/'+encodeURIComponent(filename));
            if(!response.ok) {await jsonResult(response); return;}
            const blob=await response.blob();
            if (auth.currentUser?.uid !== user?.uid) return;
            const url=URL.createObjectURL(blob);
            const a=document.createElement('a'); a.href=url; a.download=getFilename(filename); a.click();
            setTimeout(() => URL.revokeObjectURL(url),60000);
        } catch(error) {setDownloadError(error instanceof Error ? error.message : 'Download failed.');}
    };

    // Categorize assets
    const heroAssets = data?.enhancedAssets?.filter((p) => p.includes("hero") && p.includes("enhanced")) || [];
    const mockupAssets = data?.enhancedAssets?.filter((p) => (p.includes("laptop") || p.includes("phone") || p.includes("tablet") || p.includes("browser"))) || [];
    const gridAssets = data?.enhancedAssets?.filter((p) => p.includes("grid") || p.includes("collage")) || [];
    const socialAssets = data?.enhancedAssets?.filter((p) => /^(twitter|linkedin|dribbble|producthunt)-/.test(p)) || [];

    const rawHeroes = data?.pages?.flatMap((p) => p.screenshots?.filter((s) => s.type === "hero") || []) || [];
    const rawFeatures = data?.pages?.flatMap((p) => p.screenshots?.filter((s) => s.type === "feature") || []) || [];
    const domain = data?.domain || (data?.url ? new URL(data.url).hostname : "");

    // Compare mode: group by viewport
    const desktopHeroes = rawHeroes.filter((s) => s.viewport === "desktop");
    const mobileHeroes = rawHeroes.filter((s) => s.viewport === "mobile");

    if (authLoading || (user && loadedFor !== loadKey)) {
        return (
            <div className="animate-slide-up" style={{ padding: "3rem 2rem", maxWidth: "1200px", margin: "0 auto" }}>
                <div className="skeleton" style={{ height: "40px", width: "200px", marginBottom: "1rem", borderRadius: "8px" }} />
                <div className="skeleton" style={{ height: "60px", width: "400px", marginBottom: "2rem", borderRadius: "8px" }} />
                <div className="skeleton" style={{ height: "3px", marginBottom: "2rem" }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1.5rem" }}>
                    <div className="skeleton" style={{ height: "200px", borderRadius: "12px" }} />
                    <div className="skeleton" style={{ height: "200px", borderRadius: "12px" }} />
                </div>
            </div>
        );
    }

    if (!user || !data) {
        return (
            <div className="animate-slide-up" style={{ padding: "3rem 2rem", maxWidth: "1200px", margin: "0 auto" }}>
                <Navbar />
                <div style={{ textAlign: "center", paddingTop: "15vh" }}>
                    <h1 className="heading-display" style={{ fontSize: "2rem", marginBottom: "1rem" }}>No Scout Data Found</h1>
                    <p style={{ color: "var(--rope)", marginBottom: "2rem" }}>{!user ? 'Sign in to open your saved pack.' : loadError || 'This scout is unavailable for your account. Older guest packs are not attached to an account.'}</p>
                    <Link href={!user ? "/login" : "/scout"} className="btn-scout" style={{ textDecoration: "none" }}>{!user ? "Sign in" : "New Scout"}</Link>
                </div>
            </div>
        );
    }

    if (!data.pages.length) {
        return <div style={{padding:'3rem 2rem',maxWidth:'880px',margin:'0 auto'}}>
            <Navbar />
            <h1 className="heading-display">{data.status === 'failed' ? 'Capture did not finish' : 'Capture in progress'}</h1>
            <p>{data.status === 'failed' ? 'No images were saved in this pack. Try the website again.' : 'A capture can take up to four minutes. Refresh to check its status. If it was interrupted, start a new scout.'}</p>
            <button className="btn-scout" onClick={() => window.location.reload()}>Refresh</button>{' '}
            <Link href={`/scout?url=${encodeURIComponent(data.url)}`} className="btn-outline">Try a new scout</Link>
        </div>;
    }

    return (
        <div className="animate-slide-up" style={{ padding: "3rem 2rem", maxWidth: "1200px", margin: "0 auto" }}>
            {/* Header */}
            <Navbar />
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem", flexWrap: "wrap", gap: "1.5rem" }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "0.5rem" }}>
                        <span className="merit-badge animate-stamp">{data.status === "complete" ? "Asset Pack Ready" : "Captured Images"}</span>
                    </div>
                    <h1 className="heading-display" style={{ fontSize: "2.5rem" }}>Asset Pack</h1>
                    <p style={{ fontFamily: "var(--font-mono)", color: "var(--rope)", fontSize: "0.9rem", marginTop: "0.25rem" }}>
                        Scouted from <strong style={{ color: "var(--forest)" }}>{domain}</strong> · {data.pages?.length || 0} page{(data.pages?.length || 0) !== 1 ? "s" : ""} captured
                    </p>
                </div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{fontSize:"0.85rem",color:"var(--rope)"}}>Private to your account.</span>
                    <button className="btn-campfire" onClick={handleDownload} disabled={downloading} style={{ display: "flex", alignItems: "center", gap: "6px", height: "fit-content" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                        {downloading ? "Packing..." : "Download (.zip)"}
                    </button>
                </div>
            </header>
            {downloadError && <p role="alert">{downloadError}</p>}
            {!data.enhancedAssets?.length && <p>Mockups are not ready. <button className="btn-outline" disabled={!!working} onClick={() => retryStage('enhance')}>{working === 'enhance' ? 'Creating mockups…' : 'Create mockups'}</button></p>}
            {!data.copy && <p>Marketing copy has not been generated. <button className="btn-outline" disabled={!!working} onClick={() => retryStage('copy')}>{working === 'copy' ? 'Writing…' : 'Generate copy'}</button></p>}
            {data.copy && <p>AI draft: check the facts and edit before publishing.</p>}

            <hr className="rope-divider" />

            <main style={{ display: "flex", flexDirection: "column", gap: "4rem", marginTop: "2rem" }}>

                {/* AI-Generated Copy */}
                <section>
                    <h2 className="heading-section" style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "8px" }}>
                        📝 Field Report {data.copy && <span className="merit-badge" style={{ fontSize: "0.65rem" }}>AI-Generated</span>}
                    </h2>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1.5rem" }}>
                        <div className="patch-card" style={{ padding: "2rem" }}>
                            <span className="label-scout" style={{ display: "block", marginBottom: "0.75rem" }}>Elevator Pitch</span>
                            <p style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", color: "var(--forest-deep)", lineHeight: 1.4 }}>
                                {data.copy?.pitch || "No marketing draft is available yet."}
                            </p>
                            {data.copy?.tagline && (
                                <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--rope)", marginTop: "1rem", fontStyle: "italic" }}>
                                    {data.copy.tagline}
                                </p>
                            )}
                        </div>
                        <div className="patch-card" style={{ padding: "2rem" }}>
                            <span className="label-scout" style={{ display: "block", marginBottom: "0.75rem" }}>Key Highlights</span>
                            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                                {(data.copy?.blurbs || []).map((blurb, i) => (
                                    <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                                        <span style={{ width: "24px", height: "24px", borderRadius: "50%", background: "var(--forest)", color: "var(--khaki-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700, fontFamily: "var(--font-mono)", flexShrink: 0, marginTop: "2px" }}>{i + 1}</span>
                                        <p style={{ color: "var(--rope)", fontSize: "0.95rem" }}>{blurb}</p>
                                    </div>
                                ))}
                            </div>
                            {data.copy?.twitter && (
                                <>
                                    <div className="rope-divider" style={{ margin: "1.25rem 0" }} />
                                    <span className="label-scout" style={{ display: "block", marginBottom: "0.5rem" }}>Tweet Draft</span>
                                    <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "var(--charcoal)", lineHeight: 1.5 }}>
                                        {data.copy.twitter}
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                </section>

                {/* Comparison Toggle */}
                {desktopHeroes.length > 0 && mobileHeroes.length > 0 && (
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button className={compareMode ? "btn-scout" : "btn-outline"} onClick={() => setCompareMode(!compareMode)} style={{ fontSize: "0.8rem", padding: "6px 14px" }}>
                            {compareMode ? "Grid View" : "Compare Mode"}
                        </button>
                    </div>
                )}

                {/* Comparison Mode */}
                {compareMode && desktopHeroes.length > 0 && mobileHeroes.length > 0 ? (
                    <section>
                        <h2 className="heading-section" style={{ marginBottom: "1.5rem" }}>🔀 Desktop vs Mobile</h2>
                        <div className="compare-container">
                            <div className="compare-col">
                                <span className="label-scout" style={{ display: "block", marginBottom: "0.75rem", textAlign: "center" }}>Desktop</span>
                                {desktopHeroes.map((shot, i) => (
                                    <div key={i} className="patch-card" style={{ padding: "0.5rem", overflow: "hidden", marginBottom: "1rem" }}>
                                        <PrivateImage scoutId={data.id} filename={shot.path} alt="Desktop" style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block" }} />
                                    </div>
                                ))}
                            </div>
                            <div className="compare-col">
                                <span className="label-scout" style={{ display: "block", marginBottom: "0.75rem", textAlign: "center" }}>📱 Mobile</span>
                                {mobileHeroes.map((shot, i) => (
                                    <div key={i} className="patch-card" style={{ padding: "0.5rem", overflow: "hidden", marginBottom: "1rem" }}>
                                        <PrivateImage scoutId={data.id} filename={shot.path} alt="Mobile" style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block" }} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                ) : (
                    <>
                        {/* Recon Photos */}
                        {rawHeroes.length > 0 && (
                            <section>
                                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                                    <h2 className="heading-section">Recon Photos</h2>
                                    <span className="merit-badge">{rawHeroes.length} Captures</span>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.5rem" }}>
                                    {rawHeroes.map((shot, i) => (
                                        <div key={i} className="patch-card" style={{ padding: "0.75rem", overflow: "hidden" }}>
                                            <PrivateImage scoutId={data.id} filename={shot.path} alt={`${shot.viewport} hero`} style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block" }} />
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.25rem 0.25rem" }}>
                                                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--rope)", textTransform: "capitalize" }}>{shot.viewport} · {shot.width}×{shot.height}</span>
                                                <button onClick={() => downloadIndividual(shot.path)} className="btn-outline" style={{ padding: "4px 10px", fontSize: "0.7rem" }}>↓ Save</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Feature Sections */}
                        {rawFeatures.length > 0 && (
                            <section>
                                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                                    <h2 className="heading-section">🔍 Feature Sections</h2>
                                    <span className="merit-badge">{rawFeatures.length} Sections</span>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.5rem" }}>
                                    {rawFeatures.map((shot, i) => (
                                        <div key={i} className="patch-card" style={{ padding: "0.75rem", overflow: "hidden" }}>
                                            <PrivateImage scoutId={data.id} filename={shot.path} alt={`Feature ${i + 1}`} style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block" }} />
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.25rem 0.25rem" }}>
                                                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--rope)" }}>Feature {i + 1}</span>
                                                <button onClick={() => downloadIndividual(shot.path)} className="btn-outline" style={{ padding: "4px 10px", fontSize: "0.7rem" }}>↓ Save</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </>
                )}

                {/* Enhanced + Mockups */}
                {heroAssets.length > 0 && (
                    <section>
                        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                            <h2 className="heading-section">Enhanced Heroes</h2>
                            <span className="merit-badge">Auto-Enhanced</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.5rem" }}>
                            {heroAssets.map((asset, i) => (
                                <div key={i} className="patch-card" style={{ padding: "0.75rem", overflow: "hidden" }}>
                                    <PrivateImage scoutId={data.id} filename={asset} alt={`Enhanced ${i + 1}`} style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block" }} />
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.25rem 0.25rem" }}>
                                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--rope)" }}>{getFilename(asset)}</span>
                                        <button onClick={() => downloadIndividual(asset)} className="btn-outline" style={{ padding: "4px 10px", fontSize: "0.7rem" }}>↓ Save</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {mockupAssets.length > 0 && (
                    <section>
                        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                            <h2 className="heading-section">💻 Device Mockups</h2>
                            <span className="merit-badge">{mockupAssets.length} Frames</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem" }}>
                            {mockupAssets.map((asset, i) => (
                                <div key={i} className="patch-card" style={{ padding: "0.75rem", overflow: "hidden", background: "var(--parchment)" }}>
                                    <PrivateImage scoutId={data.id} filename={asset} alt={`Mockup ${i + 1}`} style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block" }} />
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.25rem 0.25rem" }}>
                                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--rope)" }}>{getFilename(asset)}</span>
                                        <button onClick={() => downloadIndividual(asset)} className="btn-outline" style={{ padding: "4px 10px", fontSize: "0.7rem" }}>↓ Save</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Grid Collages */}
                {gridAssets.length > 0 && (
                    <section>
                        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                            <h2 className="heading-section">Map Layouts</h2>
                            <span className="merit-badge">Social-Ready</span>
                        </div>
                        {gridAssets.map((asset, i) => (
                            <div key={i} className="patch-card" style={{ padding: "0.75rem", overflow: "hidden", marginBottom: "1.5rem" }}>
                                <PrivateImage scoutId={data.id} filename={asset} alt={`Collage ${i + 1}`} style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block" }} />
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.25rem 0.25rem" }}>
                                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--rope)" }}>{getFilename(asset)}</span>
                                    <button onClick={() => downloadIndividual(asset)} className="btn-outline" style={{ padding: "4px 10px", fontSize: "0.7rem" }}>↓ Save</button>
                                </div>
                            </div>
                        ))}
                    </section>
                )}

                {/* Social */}
                {socialAssets.length > 0 && (
                    <section>
                        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                            <h2 className="heading-section">📱 Social Posts</h2>
                            <span className="merit-badge">{socialAssets.length} Sizes</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1.5rem" }}>
                            {socialAssets.map((asset, i) => (
                                <div key={i} className="patch-card" style={{ padding: "0.75rem", overflow: "hidden" }}>
                                    <PrivateImage scoutId={data.id} filename={asset} alt={`Social ${i + 1}`} style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block" }} />
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0.25rem 0.25rem" }}>
                                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--rope)" }}>{getFilename(asset)}</span>
                                        <button onClick={() => downloadIndividual(asset)} className="btn-outline" style={{ padding: "4px 10px", fontSize: "0.7rem" }}>↓ Save</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </main>

            <hr className="rope-divider" style={{ marginTop: "3rem" }} />
            <p style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--rope)", letterSpacing: "2px", textTransform: "uppercase", padding: "1rem 0", opacity: 0.5 }}>
                Scouted with MyScouter
            </p>
        </div>
    );
}
