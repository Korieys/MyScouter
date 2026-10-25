import {notFound} from 'next/navigation';
import {ReadinessClient} from '@/components/readiness-client';
export const dynamic='force-dynamic';
export default function ReadinessPage() {
 // The tester adds no server capabilities and has no product navigation link.
 if(process.env.VERCEL_ENV!=='preview')notFound();
 return <ReadinessClient/>;
}
