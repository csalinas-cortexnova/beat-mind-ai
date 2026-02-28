"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-gray-500">
        {error.digest ? `Error reference: ${error.digest}` : "An unexpected error occurred"}
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
      >
        Try again
      </button>
    </div>
  );
}
