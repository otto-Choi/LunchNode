import LunchApp from '@/components/lunch-app';
import { configured } from '@/lib/server';
export default function Page(){return <LunchApp demoMode={!configured()}/>;}
