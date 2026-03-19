export default function PrivacyPage() {
  return (
    <main className="viewport-page bg-background">
      <div className="viewport-scroll mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">
            CASPO respects your privacy. This page outlines what information is collected,
            how it is used, and how users can contact us with privacy-related questions.
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Information We Collect</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            We may collect account details, organization and group activity, uploaded content,
            and usage data needed to operate the app and support group management features.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">How Information Is Used</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Information is used to provide club tools, improve product performance, support
            account access, and maintain safety, reliability, and moderation standards.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Your Controls</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Users can review account details in Settings and may request account deletion from
            within the app. Additional privacy requests can be directed to support.
          </p>
        </section>
      </div>
    </main>
  );
}
