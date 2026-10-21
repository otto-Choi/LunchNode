import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'한끼 · 함께하는 점심',description:'점심 신청 및 조 편성'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
