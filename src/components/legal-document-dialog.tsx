"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { APPLE_STANDARD_EULA_URL } from "@/lib/legal";

type LegalDocumentType = "terms" | "privacy";

type LegalDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: LegalDocumentType;
};

export function LegalDocumentDialog({
  open,
  onOpenChange,
  type,
}: LegalDocumentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-screen-md">
        <DialogHeader>
          <DialogTitle>{type === "terms" ? "Terms & Conditions" : "Privacy Policy"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm leading-relaxed">
          {type === "privacy" ? <PrivacyPolicyContent /> : <TermsContent />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PrivacyPolicyContent() {
  return (
    <>
      <p className="font-semibold">Privacy Policy for CASPO</p>
      <p>Effective Date: 3/19/2026</p>
      <p>
        CASPO operates a mobile and web application designed to help users manage clubs, groups, and communications.
      </p>
      <p>This Privacy Policy explains how we collect, use, and protect your information.</p>

      <div className="space-y-2">
        <p className="font-semibold">1. Information We Collect</p>
        <p>a. Account Information</p>
        <p>- Name</p>
        <p>- Email address</p>
        <p>- Profile information</p>
        <p>b. Usage Data</p>
        <p>- Interactions within the app</p>
        <p>- Features used (messages, events, groups, etc.)</p>
        <p>- Device and log data (IP address, browser/app version)</p>
        <p>c. Content Data</p>
        <p>- Messages</p>
        <p>- Group information</p>
        <p>- Events and forms created within the app</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">2. How We Use Your Information</p>
        <p>We use your information to:</p>
        <p>- Provide and maintain the app</p>
        <p>- Enable communication between users</p>
        <p>- Improve features and performance</p>
        <p>- Personalize your experience</p>
        <p>- Ensure security and prevent misuse</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">3. Data Sharing</p>
        <p>We do NOT sell your personal data.</p>
        <p>We may share data only:</p>
        <p>- With service providers (e.g., hosting, analytics)</p>
        <p>- If required by law</p>
        <p>- To protect users and platform integrity</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">4. Data Storage and Security</p>
        <p>
          We take reasonable steps to protect your data using industry-standard security practices. However, no system is 100% secure.
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">5. Your Rights</p>
        <p>You may:</p>
        <p>- Access your data</p>
        <p>- Request deletion of your account</p>
        <p>- Update your information</p>
        <p>To request this, contact: clubhubai@gmail.com</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">6. Third-Party Services</p>
        <p>
          We may use third-party services (e.g., authentication providers like Google). These services have their own privacy policies.
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">7. Children’s Privacy</p>
        <p>CASPO is not intended for children under 13. We do not knowingly collect data from children.</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">8. Changes to This Policy</p>
        <p>We may update this policy. Continued use of the app means you accept the updated policy.</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">9. Contact</p>
        <p>If you have questions, contact us at:</p>
        <p>clubhubai@gmail.com</p>
      </div>

      <p>By using CASPO, you agree to this Privacy Policy.</p>
    </>
  );
}

export function TermsContent() {
  return (
    <>
      <p className="font-semibold">Terms and Conditions for CASPO</p>
      <p>Effective Date: 3/19/2026</p>
      <p>By using CASPO, you agree to these Terms and Conditions.</p>

      <div className="space-y-2">
        <p className="font-semibold">1. Use of the App</p>
        <p>You agree to:</p>
        <p>- Use the app only for lawful purposes</p>
        <p>- Not misuse or disrupt the platform</p>
        <p>- Not attempt unauthorized access</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">2. Accounts</p>
        <p>- You are responsible for your account</p>
        <p>- You must provide accurate information</p>
        <p>- You are responsible for all activity under your account</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">3. User Content</p>
        <p>You may create and share content (messages, events, etc.).</p>
        <p>You agree:</p>
        <p>- Not to post harmful, illegal, or abusive content</p>
        <p>- That you are responsible for your content</p>
        <p>We reserve the right to remove content that violates these terms.</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">4. Termination</p>
        <p>We may suspend or terminate your account if you:</p>
        <p>- Violate these terms</p>
        <p>- Misuse the platform</p>
        <p>- Harm other users or the system</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">5. Intellectual Property</p>
        <p>All app content, design, and functionality are owned by CASPO and may not be copied or reused without permission.</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">6. Disclaimer</p>
        <p>CASPO is provided “as is.”</p>
        <p>We do not guarantee:</p>
        <p>- That the app will always be available</p>
        <p>- That it will be error-free</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">7. Limitation of Liability</p>
        <p>We are not liable for:</p>
        <p>- Data loss</p>
        <p>- Service interruptions</p>
        <p>- User-generated content</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">8. Changes to Terms</p>
        <p>We may update these terms at any time. Continued use means acceptance of updated terms.</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">9. Governing Law</p>
        <p>These terms are governed by the laws of the United States.</p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">10. Contact</p>
        <p>For questions, contact:</p>
        <p>clubhubai@gmail.com</p>
      </div>

      <p>By using CASPO, you agree to these Terms.</p>

      <div className="space-y-2">
        <p className="font-semibold">Standard EULA</p>
        <p>
          Use of Caspo is also subject to the Apple Standardized End User License
          Agreement:{" "}
          <a
            href={APPLE_STANDARD_EULA_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            {APPLE_STANDARD_EULA_URL}
          </a>
        </p>
      </div>
    </>
  );
}
