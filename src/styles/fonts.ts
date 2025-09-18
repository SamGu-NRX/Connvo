import localFont from "next/font/local";
import { Inter } from "next/font/google";

export const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400"],
  display: "swap",
});

export const cal = localFont({
  src: "./CalSans-SemiBold.otf",
  variable: "--font-heading",
  weight: "600",
  display: "swap",
});

export const calTitle = localFont({
  src: "./CalSans-SemiBold.otf",
  variable: "--font-heading",
  weight: "600",
  display: "swap",
});

export const fontMapper = {
  "font-cal": calTitle.variable,
  "font-inter": inter.variable,
} as Record<string, string>;
