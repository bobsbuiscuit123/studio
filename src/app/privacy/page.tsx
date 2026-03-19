export default function PrivacyPage() {
  return (
    <main className="viewport-page bg-background">
      <div className="viewport-scroll mx-auto flex w-full max-w-screen-md flex-col space-y-4 px-4 py-6 text-sm leading-relaxed">
        <h1 className="text-xl font-semibold">Privacy Policy for CASPO</h1>

        <p>Effective Date: [Insert Date]</p>

        <p>
          CASPO (“we”, “our”, or “us”) operates a mobile and web application designed to help users manage clubs, groups, and communications.
        </p>

        <p>This Privacy Policy explains how we collect, use, and protect your information.</p>

        <section className="space-y-4">
          <h2 className="font-semibold">1. Information We Collect</h2>

          <div className="space-y-2">
            <p>a. Account Information</p>
            <ul className="space-y-1 pl-4">
              <li>- Name</li>
              <li>- Email address</li>
              <li>- Profile information</li>
            </ul>
          </div>

          <div className="space-y-2">
            <p>b. Usage Data</p>
            <ul className="space-y-1 pl-4">
              <li>- Interactions within the app</li>
              <li>- Features used (messages, events, groups, etc.)</li>
              <li>- Device and log data (IP address, browser/app version)</li>
            </ul>
          </div>

          <div className="space-y-2">
            <p>c. Content Data</p>
            <ul className="space-y-1 pl-4">
              <li>- Messages</li>
              <li>- Group information</li>
              <li>- Events and forms created within the app</li>
            </ul>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">2. How We Use Your Information</h2>
          <p>We use your information to:</p>
          <ul className="space-y-1 pl-4">
            <li>- Provide and maintain the app</li>
            <li>- Enable communication between users</li>
            <li>- Improve features and performance</li>
            <li>- Personalize your experience</li>
            <li>- Ensure security and prevent misuse</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">3. Data Sharing</h2>
          <p>We do NOT sell your personal data.</p>
          <p>We may share data only:</p>
          <ul className="space-y-1 pl-4">
            <li>- With service providers (e.g., hosting, analytics)</li>
            <li>- If required by law</li>
            <li>- To protect users and platform integrity</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">4. Data Storage and Security</h2>
          <p>
            We take reasonable steps to protect your data using industry-standard security practices. However, no system is 100% secure.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">5. Your Rights</h2>
          <p>You may:</p>
          <ul className="space-y-1 pl-4">
            <li>- Access your data</li>
            <li>- Request deletion of your account</li>
            <li>- Update your information</li>
          </ul>
          <p>To request this, contact: [Your Email]</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">6. Third-Party Services</h2>
          <p>
            We may use third-party services (e.g., authentication providers like Google). These services have their own privacy policies.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">7. Children’s Privacy</h2>
          <p>
            CASPO is not intended for children under 13. We do not knowingly collect data from children.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">8. Changes to This Policy</h2>
          <p>
            We may update this policy. Continued use of the app means you accept the updated policy.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">9. Contact</h2>
          <p>If you have questions, contact us at:</p>
          <p>[Your Email]</p>
        </section>

        <p>By using CASPO, you agree to this Privacy Policy.</p>
      </div>
    </main>
  );
}
