import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold">Access Denied</h1>
      <p className="text-gray-600">
        You do not have permission to access this page.
      </p>
      <Link href="/" className="text-blue-600 underline hover:text-blue-800">
        Go to homepage
      </Link>
    </div>
  );
}
