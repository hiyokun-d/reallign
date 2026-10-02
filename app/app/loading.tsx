import { Skeleton } from "@/components/ui/skeleton";

// Shown automatically by Next.js while a page's async data loads.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64 md:col-span-2" />
      </div>
    </div>
  );
}
