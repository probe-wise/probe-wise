/** Shown instead of auth UI when the deployment has no Supabase env vars yet. */
export function SetupNotice() {
  return (
    <div className="notice notice-info" role="status">
      <p className="font-semibold">Sign-in isn&apos;t connected yet</p>
      <p className="mt-1 muted">
        This deployment has no Supabase project configured. Copy <code>.env.example</code> to{" "}
        <code>.env.local</code>, fill in the Supabase URL and publishable key, and restart. The README walks through it.
      </p>
    </div>
  );
}
