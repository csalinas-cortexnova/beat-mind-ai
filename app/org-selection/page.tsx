import { OrganizationList } from "@clerk/nextjs";

export default function OrgSelectionPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-bold">Select your gym</h1>
      <OrganizationList
        hidePersonal
        afterSelectOrganizationUrl="/dashboard"
      />
    </div>
  );
}
