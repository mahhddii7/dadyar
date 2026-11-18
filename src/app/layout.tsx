import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "داده‌یار | تحلیل مستند فایل‌ها",
  description: "فایل‌هایتان را بارگذاری کنید و پاسخ‌های دقیق و مستند بگیرید.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl"><body>{children}</body></html>;
}
