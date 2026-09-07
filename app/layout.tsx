import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";

export const metadata: Metadata = {
  title: "Beacon — EPM Intelligence & Opportunity Hub",
  description:
    "A centralised hub for personal tasks, vendor news briefs and client opportunities.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <div className="hidden w-64 shrink-0 md:block">
            <div className="sticky top-0 h-screen">
              <Sidebar />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <MobileNav />
            <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
