import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "نظام الجدول المدرسي | School Timetable System",
  description:
    "Production-grade school timetable management & automatic scheduling platform with a real constraint optimization engine.",
  keywords: [
    "school",
    "timetable",
    "scheduling",
    "constraint programming",
    "OR-Tools",
    "CP-SAT",
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Arabic-first RTL layout; the client store toggles dir/lang at runtime.
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased bg-background text-foreground" style={{ fontFamily: '"Cairo", "Inter", system-ui, sans-serif' }}>
        <Providers>{children}</Providers>
        <Toaster />
        <SonnerToaster position="top-center" />
      </body>
    </html>
  );
}
