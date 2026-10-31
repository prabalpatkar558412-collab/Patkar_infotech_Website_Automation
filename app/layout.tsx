import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"Patkar Infotech · Business workspace",description:"Your conversations, clients and projects. One connected workspace."};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}