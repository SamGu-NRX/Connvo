import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { WorkOS } from "@workos-inc/node";

const workos = new WorkOS(process.env.WORKOS_API_KEY!);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    // Redirect to sign-in if no code provided
    redirect("/api/auth/signin");
  }

  try {
    // Exchange code for user information
    const { user } = await workos.userManagement.authenticateWithCode({
      code,
      clientId: process.env.WORKOS_CLIENT_ID!,
    });

    // Redirect to the application
    // The WorkOS AuthKit will handle setting the session
    redirect("/app");
  } catch (error) {
    console.error("Authentication callback error:", error);

    // Redirect to sign-in on error
    redirect("/api/auth/signin?error=callback_failed");
  }
}
