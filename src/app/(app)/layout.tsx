import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { Logo } from "@/components/icons";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <div className="hidden border-r bg-background sm:flex sm:w-14">
        <div className="flex h-14 items-center justify-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link href="/" className="group flex items-center justify-center gap-2 text-lg font-semibold text-primary-foreground md:text-base">
            <Logo className="h-6 w-6 transition-all group-hover:scale-110" />
            <span className="sr-only">Clubhouse AI</span>
          </Link>
        </div>
        <AppSidebar />
      </div>
      <div className="flex flex-col sm:gap-4 sm:py-4 sm:pl-14">
        <AppHeader />
        <main className="grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
          {children}
        </main>
      </div>
    </div>
  );
}

// Minimalist Link component to avoid import errors
function Link({ href, className, children }: { href: string, className?: string, children: React.ReactNode }) {
  return <a href={href} className={className}>{children}</a>
}
