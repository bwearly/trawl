export type ProductionAuthReadiness = {
  isGoogleClientEnabled: boolean;
  hasAuthSecret: boolean;
  hasAuthUrl: boolean;
  hasNextAuthUrl: boolean;
  hasAuthTrustHost: boolean;
  hasGoogleClientId: boolean;
  hasGoogleClientSecret: boolean;
};

export function getProductionAuthReadiness(): ProductionAuthReadiness {
  return {
    isGoogleClientEnabled: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
    hasAuthSecret: Boolean(process.env.AUTH_SECRET),
    hasAuthUrl: Boolean(process.env.AUTH_URL),
    hasNextAuthUrl: Boolean(process.env.NEXTAUTH_URL),
    hasAuthTrustHost: Boolean(process.env.AUTH_TRUST_HOST),
    hasGoogleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
    hasGoogleClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
  };
}

