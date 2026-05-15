export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-gray-950">Privacy</h1>
      <div className="mt-6 space-y-4 text-sm leading-6 text-gray-700">
        <p>We currently store your Google sign-in profile details needed for account access: name, email, image, and account id.</p>
        <p>We also store your watchlists and alert preferences so the product can personalize your experience.</p>
        <p>We do not sell your personal data.</p>
        <p>Email alert delivery is not live in production yet. In-app alerts are available.</p>
      </div>
    </main>
  );
}
