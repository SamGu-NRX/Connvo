import "./globals.css";
import { cal, inter } from "@/styles/fonts";
import { Analytics } from "@vercel/analytics/react";
import { Providers } from "./providers";
import type { Metadata } from "next";
import { cn } from "@/lib/shadcn";
import { KGU_ARRIVAL } from "./kgu-arrival";

const title = "Connvo – Real Conversations, Better Connections";
const description =
  "Connvo is a professional networking platform focused on authentic conversations that lead to meaningful connections.";
const image = "https://connvo.com/thumbnail.png"; // Replace with your actual image URL

export const metadata: Metadata = {
  title,
  description,
  icons: ["https://connvo.com/favicon.ico"], // Replace with your actual favicon URL
  openGraph: {
    title,
    description,
    images: [image],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [image],
    creator: "@Connvo",
  },
  metadataBase: new URL("https://connvo.com"), // Replace with your actual URL
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: KGU_ARRIVAL }} />
      </head>
      <body className={cn(cal.variable, inter.variable)}>
        <Providers>
          {children}
          {/* TODO: make<Analytics /> */}
        </Providers>
      </body>
    </html>
  );
}
