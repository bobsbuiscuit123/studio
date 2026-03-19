export default function TermsPage() {
  return (
    <main className="viewport-page bg-background">
      <div className="viewport-scroll mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Terms &amp; Conditions</h1>
          <p className="text-sm text-muted-foreground">
            These terms govern access to CASPO and the use of its organization, messaging,
            calendar, gallery, and management tools.
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Use of the App</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Users must use CASPO responsibly, follow applicable school or organization rules,
            and avoid misuse, abuse, or unauthorized access to accounts or content.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Account Responsibilities</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            You are responsible for activity under your account and for maintaining accurate
            information when participating in organizations and groups.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Service Changes</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Features may evolve over time. Continued use of the app means you accept updates to
            the product and related policies as they are introduced.
          </p>
        </section>
      </div>
    </main>
  );
}
