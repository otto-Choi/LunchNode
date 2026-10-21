import { route } from '@/lib/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>route('auth',request);
export const POST=(request:Request)=>route('auth',request);
