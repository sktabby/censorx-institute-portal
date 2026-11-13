import { Link } from "react-router-dom";
import { CheckCircle2, CloudOff, EyeOff, Lock } from "lucide-react";
import { homeContent } from "../config/content";

const { hero, unsafe, devil, turningPoint, falseSafety, privacy, schools, pricing, finalCta } = homeContent;

const privacyTokenIcons = [CloudOff, EyeOff, Lock];

export default function Home() {
  return (
    <div>
      {/* 1. Hero — the guardian */}
      <section className="max-w-6xl mx-auto px-4 pt-16 md:pt-20 pb-16 md:pb-24 grid gap-10 lg:grid-cols-[1fr_0.85fr] items-center">
        <div>
          <span className="badge text-cx-accent border-cx-accent/40 bg-cx-accent/10 mb-4">
            {hero.eyebrow}
          </span>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold leading-tight md:leading-tight mb-6">
            {hero.titleLead}{" "}
            <span className="block mt-2 bg-gradient-to-r from-cx-accent to-cx-accent2 bg-clip-text text-transparent">
              {hero.titleEmphasis}
            </span>
          </h1>
          <p className="text-cx-muted md:text-lg leading-relaxed mb-8 max-w-xl">{hero.subtitle}</p>
          <div className="flex flex-wrap gap-3">
            <Link
              to={hero.primaryCta.to}
              className="min-h-11 inline-flex items-center px-5 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium hover:opacity-90 transition-opacity"
            >
              {hero.primaryCta.label}
            </Link>
            <Link
              to={hero.secondaryCta.to}
              className="min-h-11 inline-flex items-center px-5 py-2.5 rounded-lg border border-cx-border hover:border-cx-accent/50 transition-colors"
            >
              {hero.secondaryCta.label}
            </Link>
          </div>
        </div>
        <div className="relative">
          <div aria-hidden className="absolute -inset-6 rounded-full blur-3xl bg-cx-accent/10" />
          <div className="relative glass-card p-2 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)]">
            <img
              src={hero.img}
              alt={hero.imgAlt}
              className="w-full aspect-[4/5] max-h-[480px] object-cover object-[center_65%] rounded-lg"
            />
          </div>
        </div>
      </section>

      {/* 2. The reality — danger */}
      <section className="max-w-6xl mx-auto px-4 py-16 md:py-24 border-t border-cx-border">
        <h2 className="text-2xl md:text-3xl font-semibold text-center mb-10 md:mb-14">{unsafe.title}</h2>

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-14 items-center mb-16 md:mb-24">
          <div className="relative">
            <div aria-hidden className="absolute -inset-6 rounded-full blur-3xl bg-cx-accent/5" />
            <div className="relative glass-card p-2 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)]">
              <img
                src={unsafe.img}
                alt={unsafe.imgAlt}
                loading="lazy"
                className="w-full aspect-[4/3] object-cover object-[center_45%] rounded-lg"
              />
            </div>
          </div>
          <div className="space-y-5">
            {unsafe.stats.map((stat) => (
              <div key={stat.value} className="glass-card p-6 md:p-7">
                <p className="text-4xl md:text-5xl font-semibold text-cx-accent mb-3">{stat.value}</p>
                <p className="text-cx-muted leading-relaxed">{stat.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* A quiet, dignified moment — no imagery, no accent color */}
        <div className="max-w-3xl mx-auto rounded-xl2 border border-cx-border bg-black/40 px-6 py-12 md:px-14 md:py-16 text-center space-y-8">
          <p className="text-xs uppercase tracking-[0.35em] text-cx-muted">{unsafe.heartbreak.label}</p>
          <p className="text-lg md:text-xl leading-relaxed md:leading-loose text-cx-text/90">
            {unsafe.heartbreak.story}
          </p>
          <p className="text-sm md:text-base text-cx-muted leading-relaxed">{unsafe.heartbreak.stat}</p>
        </div>
      </section>

      {/* 3. The confrontation — helplessness */}
      <section className="max-w-4xl mx-auto px-4 py-16 md:py-24 border-t border-cx-border">
        <h2 className="text-2xl md:text-3xl font-semibold text-center mb-10 md:mb-14">{devil.title}</h2>
        <div className="divide-y divide-cx-border border-y border-cx-border">
          {devil.questions.map((question) => (
            <div
              key={question}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-8 py-8 md:py-10"
            >
              <p className="text-lg md:text-xl text-cx-muted leading-relaxed max-w-xl">{question}</p>
              <p className="text-5xl md:text-7xl font-bold tracking-tight text-cx-text self-end sm:self-auto">
                {devil.answer}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. The turning point — hope */}
      <section className="max-w-3xl mx-auto px-4 py-16 md:py-24 border-t border-cx-border text-center">
        <h2 className="text-2xl md:text-3xl font-semibold mb-6">{turningPoint.title}</h2>
        <p className="text-cx-muted md:text-lg leading-relaxed mb-12">{turningPoint.body}</p>
        <p className="text-2xl md:text-4xl font-semibold leading-snug md:leading-snug bg-gradient-to-r from-cx-accent to-cx-accent2 bg-clip-text text-transparent">
          {turningPoint.pivot}
        </p>
      </section>

      {/* 5. The betrayal of existing tools */}
      <section className="max-w-6xl mx-auto px-4 py-16 md:py-24 border-t border-cx-border">
        <h2 className="text-2xl md:text-3xl font-semibold text-center mb-10 md:mb-14">{falseSafety.title}</h2>
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-14 items-center">
          <div className="relative lg:order-2">
            <div aria-hidden className="absolute -inset-6 rounded-full blur-3xl bg-cx-accent/5" />
            <div className="relative glass-card p-2 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)]">
              <img
                src={falseSafety.img}
                alt={falseSafety.imgAlt}
                loading="lazy"
                className="w-full aspect-[4/3] object-cover object-[center_40%] rounded-lg"
              />
            </div>
          </div>
          <div className="space-y-5">
            {falseSafety.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 40)} className="text-cx-muted leading-relaxed md:text-lg">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
        <div className="text-center mt-14 md:mt-20">
          <p className="text-sm uppercase tracking-widest text-cx-muted mb-4">{falseSafety.verdictLead}</p>
          <p className="text-3xl md:text-4xl font-semibold leading-snug max-w-2xl mx-auto">{falseSafety.verdict}</p>
          <div aria-hidden className="mt-6 mx-auto h-1 w-24 rounded-full bg-gradient-to-r from-cx-accent to-cx-accent2" />
        </div>
      </section>

      {/* 6. The promise — privacy */}
      <section className="max-w-3xl mx-auto px-4 py-16 md:py-24 border-t border-cx-border text-center">
        <h2 className="text-2xl md:text-3xl font-semibold mb-8">{privacy.title}</h2>
        <p className="text-cx-muted md:text-lg leading-relaxed mb-8">{privacy.intro}</p>
        <p className="text-3xl md:text-4xl font-semibold text-cx-accent2 mb-8">{privacy.defiance}</p>
        <p className="text-cx-text/90 md:text-lg leading-relaxed mb-12">{privacy.promise}</p>
        <div className="grid gap-4 sm:grid-cols-3 mb-12">
          {privacy.tokens.map((token, index) => {
            const Icon = privacyTokenIcons[index];
            return (
              <div key={token} className="glass-card px-4 py-6 flex flex-col items-center gap-3">
                <Icon className="text-cx-accent2" size={24} />
                <span className="font-semibold text-lg">{token}</span>
              </div>
            );
          })}
        </div>
        <p className="text-cx-muted italic leading-relaxed">{privacy.closing}</p>
      </section>

      {/* 7. Why schools */}
      <section className="max-w-6xl mx-auto px-4 py-16 md:py-24 border-t border-cx-border">
        <div className="max-w-3xl mx-auto text-center mb-10 md:mb-14">
          <h2 className="text-2xl md:text-3xl font-semibold mb-5">{schools.title}</h2>
          <p className="text-cx-muted md:text-lg leading-relaxed">{schools.intro}</p>
        </div>
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-14 items-center">
          <div className="relative">
            <div aria-hidden className="absolute -inset-6 rounded-full blur-3xl bg-cx-accent2/10" />
            <div className="relative glass-card p-2 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)]">
              <img
                src={schools.img}
                alt={schools.imgAlt}
                loading="lazy"
                className="w-full aspect-[4/3] object-cover object-[35%_center] rounded-lg"
              />
            </div>
          </div>
          <ul className="space-y-4">
            {schools.benefits.map((benefit) => (
              <li key={benefit} className="glass-card p-5 flex items-start gap-3">
                <CheckCircle2 className="text-cx-accent2 shrink-0 mt-0.5" size={20} />
                <span className="text-cx-text/90 leading-relaxed">{benefit}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 8. Pricing — a contribution */}
      <section className="max-w-6xl mx-auto px-4 py-16 md:py-24 border-t border-cx-border">
        <div className="max-w-2xl mx-auto glass-card px-6 py-12 md:px-14 md:py-16 text-center">
          <span className="badge text-cx-accent2 border-cx-accent2/40 bg-cx-accent2/10 mb-6">{pricing.badge}</span>
          <p className="mb-6">
            <span className="text-5xl md:text-6xl font-semibold">{pricing.price}</span>
            <span className="text-cx-muted text-lg ml-1">{pricing.period}</span>
          </p>
          <p className="text-cx-muted leading-relaxed mb-8">{pricing.body}</p>
          <Link
            to={pricing.cta.to}
            className="min-h-11 inline-flex items-center px-6 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium hover:opacity-90 transition-opacity"
          >
            {pricing.cta.label}
          </Link>
        </div>
      </section>

      {/* Existing closing contact section — kept intact */}
      <section className="max-w-6xl mx-auto px-4 py-20 border-t border-cx-border text-center">
        <h2 className="text-3xl font-semibold mb-4">{finalCta.title}</h2>
        <p className="text-cx-muted mb-6">{finalCta.body}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to={finalCta.primaryCta.to}
            className="min-h-11 inline-flex items-center px-5 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium hover:opacity-90 transition-opacity"
          >
            {finalCta.primaryCta.label}
          </Link>
          <Link
            to={finalCta.secondaryCta.to}
            className="min-h-11 inline-flex items-center px-5 py-2.5 rounded-lg border border-cx-border hover:border-cx-accent/50 transition-colors"
          >
            {finalCta.secondaryCta.label}
          </Link>
        </div>
      </section>
    </div>
  );
}
