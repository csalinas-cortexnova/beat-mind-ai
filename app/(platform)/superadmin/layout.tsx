import { requireSuperAdmin } from "@/lib/auth/guards";
import { SuperAdminSidebar } from "@/components/superadmin/sidebar";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth guard — redirects to /sign-in or /unauthorized if not superadmin
  await requireSuperAdmin();

  return (
    <div className="flex h-screen bg-gray-100">
      <SuperAdminSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
