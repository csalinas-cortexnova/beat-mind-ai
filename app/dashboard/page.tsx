import { getRedirectPath } from "@/lib/auth/redirect";

export default async function DashboardPage() {
  await getRedirectPath();
}
