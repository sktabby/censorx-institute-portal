import type { ReactNode } from "react";
import { Search } from "lucide-react";

/**
 * Visual wrapper that places a search icon inside an existing input.
 * Pass the input as the child and give it the "pl-10" class.
 */
export default function SearchBox({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-w-0">
      <Search
        aria-hidden="true"
        size={16}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cx-muted"
      />
      {children}
    </div>
  );
}
