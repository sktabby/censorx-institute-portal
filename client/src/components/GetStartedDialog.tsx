import { useEffect, useRef } from "react";
import { Activity, Lock, LogIn, Mail, Rocket, Share2, Smartphone, X, type LucideIcon } from "lucide-react";
import { guideSteps } from "../config/guideSteps";

const STEP_ICONS: LucideIcon[] = [LogIn, Lock, Mail, Share2, Smartphone, Activity];

/**
 * Popup that shows the "Get started" steps as a stepper. A centred card on larger
 * screens and a bottom sheet on phones. Purely informational.
 */
export default function GetStartedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-cx-night/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="get-started-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-lg animate-pop flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_30px_80px_-20px_rgba(4,21,20,0.6)] motion-reduce:animate-none sm:rounded-3xl"
      >
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-cx-accent to-cx-night px-5 py-5 text-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-cx-bright/25 blur-2xl"
          />
          <div className="relative flex items-center gap-3.5 pr-10">
            <span className="inline-flex h-12 w-12 shrink-0 -rotate-6 items-center justify-center rounded-2xl bg-cx-night ring-2 ring-cx-bright/80 shadow-[0_8px_24px_rgba(50,178,169,0.4)]">
              <Rocket size={22} aria-hidden="true" className="text-cx-bright" />
            </span>
            <div className="min-w-0">
              <h2 id="get-started-title" className="font-serif text-2xl font-semibold italic leading-tight text-white">
                Get started
              </h2>
              <p className="mt-0.5 text-xs uppercase tracking-[0.2em] text-white/70">
                {guideSteps.length} simple steps
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Steps */}
        <ol className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [scrollbar-width:thin]">
          {guideSteps.map((step, index) => {
            const Icon = STEP_ICONS[index] ?? Activity;
            return (
              <li
                key={step.title}
                className="group relative flex gap-4 pb-5 animate-fade-up motion-reduce:animate-none last:pb-0"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-[21px] top-12 w-0.5 rounded bg-cx-tint2 group-last:hidden"
                />
                <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cx-tint text-cx-accent ring-1 ring-cx-accent/20">
                  <Icon size={20} aria-hidden="true" />
                  <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cx-dark text-[10px] font-bold text-white ring-2 ring-white">
                    {index + 1}
                  </span>
                </span>
                <div className="min-w-0 pt-0.5">
                  <h3 className="font-semibold text-cx-heading">{step.title}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-cx-muted">{step.text}</p>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Footer */}
        <div className="shrink-0 border-t border-cx-border p-4">
          <button type="button" onClick={onClose} className="cx-btn-primary w-full">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
