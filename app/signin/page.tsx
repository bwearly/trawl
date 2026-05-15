import SignInClient from "@/components/auth/SignInClient";
import { getProductionAuthReadiness } from "@/lib/auth/auth-readiness";

export default function SignInPage() {
  const productionReadiness = getProductionAuthReadiness();
  return <SignInClient productionReadiness={productionReadiness} />;
}
