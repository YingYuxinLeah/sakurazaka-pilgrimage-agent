import type { Metadata } from "next";
import "./globals.css";

export const metadata:Metadata={title:"坂道巡礼 Agent",description:"通过真实多轮 Agent 规划坂道巡礼路线。",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><head><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" defer/></head><body>{children}</body></html>}
