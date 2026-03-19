import { TermsContent } from "@/components/legal-document-dialog";

export default function TermsPage() {
  return (
    <main className="viewport-page bg-background">
      <div className="viewport-scroll mx-auto flex w-full max-w-screen-md flex-col space-y-4 px-4 py-6 text-sm leading-relaxed">
        <TermsContent />
      </div>
    </main>
  );
}
