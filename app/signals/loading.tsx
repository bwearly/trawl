import SignalsPageSkeleton from "@/components/signals/SignalsPageSkeleton";

export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 space-y-4">
          <div className="w-full">
            <div className="h-4 w-40 rounded bg-gray-200 motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="mt-3 h-10 w-72 rounded bg-gray-200 motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="mt-3 h-4 w-full max-w-2xl rounded bg-gray-200 motion-safe:animate-pulse motion-reduce:animate-none" />
          </div>
        </div>
        <SignalsPageSkeleton />
      </div>
    </main>
  );
}
