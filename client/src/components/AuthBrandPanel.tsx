const PHOTO_ALT = "Two students holding notebooks in front of a chalkboard that reads I love school";

/** Logo + wordmark lockup used on the sign-in screens. Purely visual. */
function BrandLockup() {
  return (
    <div className="relative flex items-center gap-4">
      <span className="relative inline-flex h-14 w-14 shrink-0 -rotate-6 items-center justify-center rounded-2xl bg-cx-deep ring-2 ring-cx-bright shadow-[0_10px_30px_rgba(50,178,169,0.45)] sm:h-16 sm:w-16">
        <span aria-hidden="true" className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/15 to-transparent" />
        <img src="/censorx-logo.png" alt="" className="relative h-10 w-10 object-contain sm:h-11 sm:w-11" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-3xl font-black tracking-tight text-white sm:text-4xl">
          Censor<span className="text-cx-bright">X</span>
        </span>
        <span className="mt-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.32em] text-white/85 sm:text-xs">
          <span aria-hidden="true" className="h-px w-6 bg-cx-bright" />
          for Schools
        </span>
      </span>
    </div>
  );
}

/**
 * Brand panel for the login and password-reset screens: a short header band on
 * phones (logo and heading only), a full-height column with the photo from md up.
 */
export default function AuthBrandPanel() {
  return (
    <aside className="relative overflow-hidden bg-gradient-to-br from-cx-accent to-cx-deep px-5 pb-6 pt-6 text-white sm:px-8 md:flex md:min-h-screen md:w-[45%] md:flex-col md:rounded-r-[2rem] md:px-12 md:py-12 lg:px-16">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cx-bright/20 blur-2xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-20 hidden h-96 w-96 rounded-full bg-cx-bright/10 blur-3xl md:block" />

      <div className="relative flex justify-center">
        <BrandLockup />
      </div>

      <div className="relative mx-auto mt-5 w-full text-center md:mt-12 md:max-w-xl">
        <h2 className="whitespace-nowrap text-4xl font-light leading-[1.05] tracking-tight text-white md:text-3xl lg:text-5xl xl:text-6xl">
          Welcome{" "}
          <span className="bg-gradient-to-r from-white to-cx-bright bg-clip-text font-serif font-semibold italic text-transparent">
            back.
          </span>
        </h2>

        {/* Photo: desktop only. Phones show it below the form instead. */}
        <div className="mt-6 hidden overflow-hidden rounded-3xl shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/20 md:block">
          <img
            src="/school-login.jpg"
            alt={PHOTO_ALT}
            decoding="async"
            className="aspect-[3/2] w-full object-cover object-[center_45%]"
          />
        </div>
      </div>
    </aside>
  );
}

/** Plain photo shown under the form on phones only: no frame, no background. */
export function MobileAuthImage() {
  return (
    <img
      src="/school-login.jpg"
      alt={PHOTO_ALT}
      decoding="async"
      loading="lazy"
      className="mt-8 aspect-[3/2] w-full rounded-2xl object-cover md:hidden"
    />
  );
}
