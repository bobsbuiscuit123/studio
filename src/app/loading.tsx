export default function Loading() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-background text-slate-700">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      <div className="text-base font-semibold">Loading your workspace</div>
      <div className="text-sm text-slate-500">This usually takes a moment.</div>
    </div>
  );
}
