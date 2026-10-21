import { route } from '@/lib/server';
export const runtime='nodejs';
export const POST=(request:Request)=>route('admin',request);
