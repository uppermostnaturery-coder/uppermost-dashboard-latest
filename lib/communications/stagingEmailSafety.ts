// Staging is a no-email environment until a separately reviewed sending rollout.
// Use server environment signals; request bodies and allowlists cannot opt out.
export function stagingEmailSuppressionReason(): string | null {
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  const database = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const base = process.env.COMMUNICATION_BASE_URL?.replace(/\/$/, '');
  const stagingDatabase = 'https://jwsivyxapfnyaafdcdos.supabase.co';
  const stagingBase = 'https://staging.uppermost.store';
  const staging = branch === 'staging' || database === stagingDatabase || base === stagingBase;
  if (!staging) return null;

  if (process.env.VERCEL_ENV !== 'preview' || branch !== 'staging'
      || database !== stagingDatabase || base !== stagingBase
      || process.env.COMMUNICATION_DRY_RUN !== 'true') {
    return 'STAGING_EMAIL_CONFIGURATION_INVALID';
  }
  return 'STAGING_EMAIL_DRY_RUN';
}
