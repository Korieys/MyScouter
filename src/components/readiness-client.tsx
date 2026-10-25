"use client";
import {useAuth} from '@/lib/auth-context';
import {auth} from '@/lib/firebase';
import {Navbar} from './navbar';
import {HostedPrivacyChecks} from './hosted-privacy-checks';
import {HistoryFixtureChecks} from './history-fixture-checks';
export function ReadinessClient() {
 const {user,loading}=useAuth();
 return <main style={{padding:'2rem'}}><Navbar/>{loading?<p role="status">Loading test session…</p>:user?<div key={user.uid}><HostedPrivacyChecks user={user} current={()=>auth.currentUser?.uid===user.uid}/><HistoryFixtureChecks user={user} current={()=>auth.currentUser?.uid===user.uid}/></div>:<p>Sign in to the dedicated test account before opening this preview verification page.</p>}</main>;
}
