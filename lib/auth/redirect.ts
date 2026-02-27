import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * Determines the appropriate redirect path based on the user's role
 * and redirects them. Always throws (via redirect()).
 */
export async function getRedirectPath(): Promise<never> {
  const { userId, orgId, orgRole, sessionClaims } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const isSuperAdmin =
    (sessionClaims?.metadata as { isSuperAdmin?: boolean } | undefined)
      ?.isSuperAdmin === true;

  if (isSuperAdmin) {
    redirect("/superadmin");
  }

  if (!orgId) {
    redirect("/org-selection");
  }

  switch (orgRole) {
    case "org:admin":
    case "org:trainer":
      redirect("/gym");
    case "org:athlete":
      redirect("/athlete");
    default:
      redirect("/unauthorized");
  }
}
