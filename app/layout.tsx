import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uppermôst. — Analytics Intelligence",
  description: "Live analytics dashboard for uppermost.store",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
