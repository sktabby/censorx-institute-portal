import type { ReactNode } from "react";

/**
 * Minimal page heading pinned just under the top bar. It cancels the page's top
 * padding so there is no gap above it, and uses the plain page background.
 */
export default function PageHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="sticky top-16 z-20 -mx-4 -mt-4 mb-4 bg-white px-4 py-3 sm:-mx-6 sm:-mt-6 sm:px-6 md:-mx-8 md:-mt-8 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-40">
          <h1 className="break-words text-xl font-bold leading-tight tracking-tight text-cx-heading">{title}</h1>
          {description && (
            <p className="mt-0.5 line-clamp-2 max-w-3xl text-xs leading-snug text-cx-muted sm:text-sm">
              {description}
            </p>
          )}
        </div>
        {action && <div className="max-w-full shrink-0">{action}</div>}
      </div>
    </div>
  );
}
