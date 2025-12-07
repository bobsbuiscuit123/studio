
'use client';

import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr] print:block print:md:grid-cols-1 print:lg:grid-cols-1">
      <div className="print:hidden">
        <AppSidebar />
      </div>
      <div className="flex flex-col relative">
        <div className="print:hidden">
          <AppHeader />
        </div>
        <main className="flex-1 flex flex-col gap-4 p-4 lg:gap-6 lg:p-6 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
