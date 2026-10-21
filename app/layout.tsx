import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'런치노드 · 점심 신청 및 조 편성',description:'점심 신청 및 조 편성'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
