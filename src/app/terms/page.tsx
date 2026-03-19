export default function TermsPage() {
  return (
    <main className="viewport-page bg-background">
      <div className="viewport-scroll mx-auto flex w-full max-w-screen-md flex-col space-y-4 px-4 py-6 text-sm leading-relaxed">
        <h1 className="text-xl font-semibold">Terms and Conditions for CASPO</h1>

        <p>Effective Date: [Insert Date]</p>

        <p>By using CASPO, you agree to these Terms and Conditions.</p>

        <section className="space-y-2">
          <h2 className="font-semibold">1. Use of the App</h2>
          <p>You agree to:</p>
          <ul className="space-y-1 pl-4">
            <li>- Use the app only for lawful purposes</li>
            <li>- Not misuse or disrupt the platform</li>
            <li>- Not attempt unauthorized access</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">2. Accounts</h2>
          <ul className="space-y-1 pl-4">
            <li>- You are responsible for your account</li>
            <li>- You must provide accurate information</li>
            <li>- You are responsible for all activity under your account</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">3. User Content</h2>
          <p>You may create and share content (messages, events, etc.).</p>
          <p>You agree:</p>
          <ul className="space-y-1 pl-4">
            <li>- Not to post harmful, illegal, or abusive content</li>
            <li>- That you are responsible for your content</li>
          </ul>
          <p>We reserve the right to remove content that violates these terms.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">4. Termination</h2>
          <p>We may suspend or terminate your account if you:</p>
          <ul className="space-y-1 pl-4">
            <li>- Violate these terms</li>
            <li>- Misuse the platform</li>
            <li>- Harm other users or the system</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">5. Intellectual Property</h2>
          <p>
            All app content, design, and functionality are owned by CASPO and may not be copied or reused without permission.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">6. Disclaimer</h2>
          <p>CASPO is provided “as is.”</p>
          <p>We do not guarantee:</p>
          <ul className="space-y-1 pl-4">
            <li>- That the app will always be available</li>
            <li>- That it will be error-free</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">7. Limitation of Liability</h2>
          <p>We are not liable for:</p>
          <ul className="space-y-1 pl-4">
            <li>- Data loss</li>
            <li>- Service interruptions</li>
            <li>- User-generated content</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">8. Changes to Terms</h2>
          <p>
            We may update these terms at any time. Continued use means acceptance of updated terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">9. Governing Law</h2>
          <p>These terms are governed by the laws of [Your State/Country].</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">10. Contact</h2>
          <p>For questions, contact:</p>
          <p>[Your Email]</p>
        </section>

        <p>By using CASPO, you agree to these Terms.</p>
      </div>
    </main>
  );
}
