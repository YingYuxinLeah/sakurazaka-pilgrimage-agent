import type { Metadata } from "next";
import "./globals.css";

export const metadata:Metadata={title:"櫻坂圣地巡礼路线规划 Agent",description:"将自然语言需求转化为可执行的櫻坂46圣地巡礼步行路线。",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><head><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" defer/></head><body>{children}</body></html>}
