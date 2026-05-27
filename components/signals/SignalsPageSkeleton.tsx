function SkeletonBlock({ className }: { className: string }) {
  return <div className={`rounded-lg bg-gray-200 motion-safe:animate-pulse motion-reduce:animate-none ${className}`} />;
}

export default function SignalsPageSkeleton() {
  return (
    <div className="animate-fade-up">
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <SkeletonBlock key={idx} className="h-10 w-full" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="space-y-3">
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="h-6 w-4/5" />
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-4 w-2/3" />
              <div className="pt-2">
                <SkeletonBlock className="h-9 w-36" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
