import LunchApp from '@/components/lunch-app';
import { isDemoMode } from '@/lib/server';
export const dynamic='force-dynamic';
export default function Page(){return <LunchApp demoMode={isDemoMode()}/>;}
