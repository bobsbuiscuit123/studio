
import { AppHeader } from "@/components/app-header";

export default function BrowseClubsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen">
        <AppHeader />
        <main className="flex-1 p-4 lg:p-6">
            {children}
        </main>
    </div>
  );
}
