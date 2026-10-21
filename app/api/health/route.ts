import { route } from '@/lib/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>route('health',request);
