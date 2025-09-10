import { redirect } from "next/navigation";
import { WorkOS } from "@workos-inc/node";

const workos = new WorkOS(process.env.WORKOS_API_KEY!);

export async function GET() {
  const logoutUrl = workos.userManagement.getLogoutUrl({
    sessionId: "", // Will be handled by WorkOS AuthKit
  });

  redirect(logoutUrl);
}
