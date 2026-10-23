import LunchApp from '@/components/lunch-app';
import {isDemoMode} from '@/lib/server';
import {demoDates,demoPeople,demoNow,makeDemo} from '@/lib/demo';
export const dynamic='force-dynamic';
export default function Page(){const demo=isDemoMode();return <LunchApp demoMode={demo} initialDemo={demo?{demo:true,user:demoPeople[0],people:demoPeople,dates:demoDates,state:makeDemo(),now:demoNow}:undefined}/>;}
