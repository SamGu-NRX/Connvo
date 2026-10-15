import { notFound } from "next/navigation";
import AuthProof from "./auth-proof-client";

export const metadata = { title: "auth proof (eval)" };

/**
 * EVAL-ONLY page (CALL-PLAN.md D3, task connvo-call-harness-f1). 404 unless
 * the harness env is on. Mounted inside the app Providers, so in eval mode
 * ConvexClientProvider uses the test auth adapter and every Convex call is
 * authenticated with harness-minted tokens.
 */
export default async function AuthProofPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH !== "1") notFound();
  const sp = await searchParams;
  const as = typeof sp.as === "string" ? sp.as.toUpperCase() : "A";
  const meetingId = typeof sp.meeting === "string" ? sp.meeting : "";
  return <AuthProof as={as} meetingId={meetingId} />;
}
