import { Link } from "react-router-dom";

const hero = {
  title: "Features",
  subtitle:
    "An all-in-one AI-powered Application that censors harmful content and detects online harassment — in real time.",
};

const features = [
  {
    number: "01",
    title: "Real-Time Content Blurring",
    desc: "CensorX blurs inappropriate content the instant it appears — before your child can even see it.",
    img: "/WhatsApp Image 2026-08-25 at 14.47.56.jpeg",
    alt: "A parent gently covering her children's eyes while they hold a glowing tablet",
    imgPosition: "object-center",
  },
  {
    number: "02",
    title: "Harassment Detection & Instant First-Aid",
    desc: "The moment anyone abuses or harasses your child through social media, you're informed. And your child isn't left alone either — instant first-aid help is right there for them.",
    img: "/WhatsApp Image 2026-08-25 at 14.45.31.jpeg",
    alt: "A child standing alone against a purple wall, face lit only by a phone screen",
    imgPosition: "object-[center_40%]",
  },
  {
    number: "03",
    title: "Weekly Screen-Time Reports",
    desc: "Every week, you see exactly how your child spent their time online — no guessing, no surprises.",
    img: "/WhatsApp Image 2026-08-25 at 14.45.30.jpeg",
    alt: "A child sitting comfortably on a bed, calmly using a phone in warm light",
    imgPosition: "object-center",
  },
  {
    number: "04",
    title: "Short-Video Control",
    desc: "Short videos. The most addictive, most mindless corner of social media — built to trap your child in an endless scroll with no end in sight. CensorX gives you the power to shut it down completely, or set the limit yourself.",
    img: "/WhatsApp Image 2026-08-25 at 14.45.31 (2).jpeg",
    alt: "A close-up of a child absorbed in scrolling a phone under purple light",
    imgPosition: "object-[center_35%]",
  },
];

export default function Features() {
  return (
    <div>
      <section className="max-w-6xl mx-auto px-4 pt-16 md:pt-20 pb-12 md:pb-16 text-center">
        <h1 className="text-3xl md:text-4xl font-semibold mb-4">{hero.title}</h1>
        <p className="text-cx-muted md:text-lg max-w-2xl mx-auto leading-relaxed">{hero.subtitle}</p>
      </section>

      <section className="max-w-6xl mx-auto px-4 pb-20 md:pb-28">
        <div className="space-y-20 md:space-y-28">
          {features.map((feature, index) => {
            const flipped = index % 2 === 1;
            const accentText = flipped ? "text-cx-accent2" : "text-cx-accent";
            const accentLine = flipped ? "bg-cx-accent2/40" : "bg-cx-accent/40";
            const accentGlow = flipped ? "bg-cx-accent2/10" : "bg-cx-accent/10";

            return (
              <article
                key={feature.number}
                className="grid gap-8 lg:grid-cols-2 lg:gap-16 items-center"
              >
                <div className={`relative ${flipped ? "lg:order-2" : ""}`}>
                  <div aria-hidden className={`absolute -inset-6 rounded-full blur-3xl ${accentGlow}`} />
                  <div className="relative glass-card p-2 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)]">
                    <img
                      src={feature.img}
                      alt={feature.alt}
                      loading={index === 0 ? "eager" : "lazy"}
                      className={`w-full aspect-[4/3] object-cover rounded-lg ${feature.imgPosition}`}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`font-mono text-sm tracking-widest ${accentText}`}>{feature.number}</span>
                    <span className={`h-px w-12 ${accentLine}`} />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-semibold mb-4">{feature.title}</h2>
                  <p className="text-cx-muted md:text-lg leading-relaxed">{feature.desc}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-20 border-t border-cx-border text-center">
        <h2 className="text-3xl font-semibold mb-4">Your Digital Guardian, On Duty 24/7</h2>
        <p className="text-cx-muted mb-6 max-w-xl mx-auto">
          Bring CensorX protection to your school or family — plans, seats, and deployment set up directly with our team.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to="/contact"
            className="min-h-11 inline-flex items-center px-5 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium hover:opacity-90 transition-opacity"
          >
            Partner With CensorX
          </Link>
          <Link
            to="/login"
            className="min-h-11 inline-flex items-center px-5 py-2.5 rounded-lg border border-cx-border hover:border-cx-accent/50 transition-colors"
          >
            Institute Login
          </Link>
        </div>
      </section>
    </div>
  );
}
