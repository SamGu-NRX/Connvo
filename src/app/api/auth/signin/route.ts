import { redirect } from "next/navigation";
import { WorkOS } from "@workos-inc/node";

const workos = new WorkOS(process.env.WORKOS_API_KEY!);

export async function GET() {
  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    // Redirect to WorkOS AuthKit
    provider: "authkit",
    clientId: process.env.WORKOS_CLIENT_ID!,
    redirectUri: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI!,
  });

  redirect(authorizationUrl);
}
