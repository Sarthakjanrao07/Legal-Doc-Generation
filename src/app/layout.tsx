import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Legal Document Generator - AI-Powered Legal Documents",
  description: "Create professional legal documents like Wills and Power of Attorney with AI assistance. Fast, easy, and accurate.",
  keywords: ["Legal Documents", "Will", "Power of Attorney", "AI", "Document Generator"],
  authors: [{ name: "Legal Document Generator" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased bg-background text-foreground font-sans`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
