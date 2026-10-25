"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Navbar } from '@/components/navbar';
import { ScoutHistory } from '@/components/scout-history';

export default function Dashboard() {
    const {user, loading} = useAuth();
    const router = useRouter();
    useEffect(() => { if (!loading && !user) router.replace('/login?next=/dashboard'); }, [user, loading, router]);
    return <div className="history-dashboard">
        <Navbar />
        <hr className="rope-divider" />
        <main>{loading || !user ? <p role="status">Loading your account…</p> : <ScoutHistory user={user} />}</main>
    </div>;
}
