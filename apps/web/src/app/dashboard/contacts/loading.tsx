import { StatCardsSkeleton, TableRowsSkeleton, SkeletonBlock } from "@cc/ui";

export default function ContactsLoading() {
  return (
    <div className="w-full px-6 py-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div className="space-y-2">
          <SkeletonBlock className="h-7 w-64" />
          <SkeletonBlock className="h-4 w-96" />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-9 w-36 rounded-lg" />
          <SkeletonBlock className="h-9 w-32 rounded-lg" />
          <SkeletonBlock className="h-9 w-36 rounded-lg" />
        </div>
      </div>

      <StatCardsSkeleton count={4} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-3 bg-white rounded-xl border border-neutral-200 p-4 space-y-3">
          <SkeletonBlock className="h-4 w-28" />
          <SkeletonBlock className="h-8 w-full rounded-md" />
          <SkeletonBlock className="h-8 w-full rounded-md" />
          <SkeletonBlock className="h-8 w-full rounded-md" />
          <SkeletonBlock className="h-4 w-32 mt-4" />
          <SkeletonBlock className="h-8 w-full rounded-md" />
          <SkeletonBlock className="h-8 w-full rounded-md" />
        </div>
        <div className="lg:col-span-9 bg-white rounded-xl border border-neutral-200 p-4 space-y-4">
          <div className="flex items-center gap-3">
            <SkeletonBlock className="h-9 flex-1 rounded-lg" />
            <SkeletonBlock className="h-9 w-36 rounded-lg" />
            <SkeletonBlock className="h-9 w-36 rounded-lg" />
          </div>
          <TableRowsSkeleton rows={8} columns={6} />
        </div>
      </div>
    </div>
  );
}
