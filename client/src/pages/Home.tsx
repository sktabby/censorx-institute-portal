import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  KeyRound,
  Layers,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";

const solutionCards = [
  { title: "Secure Student Codes", desc: "Cryptographically random, single-use activation codes for every student.", icon: KeyRound },
  { title: "Flexible School Plans", desc: "Monthly, three-month, six-month, yearly, or fully custom plan durations.", icon: Layers },
  { title: "Centralized Code Management", desc: "Track each code from issue to redemption, replacement, revocation, or expiry.", icon: ListChecks },
  { title: "Android App Protection", desc: "Students redeem codes directly inside the CensorX Android app.", icon: Smartphone },
];

const steps = [
  "CensorX creates the school account.",
  "CensorX assigns a subscription and seat limit.",
  "Secure student activation codes are generated.",
  "Students redeem codes inside the CensorX Android app.",
  "The school views code and student status in the portal.",
];

const subscriptionItems = [
  {
    icon: Clock,
    title: "Flexible plan duration",
    desc: "Choose Monthly, Three months, Six months, Yearly, or a fully Custom duration. CensorX sets this up with each school directly.",
  },
  {
    icon: Users,
    title: "Seat-based access",
    desc: "A school purchases access for a set number of student seats. For example, 200 seats covers up to 200 students at once.",
  },
  {
    icon: KeyRound,
    title: "One code per seat",
    desc: "Each seat is represented by a unique, single-use activation code distributed by the school and redeemed once in the Android app.",
  },
  {
    icon: RefreshCw,
    title: "Managed over time",
    desc: "CensorX can renew a plan, extend the current expiry date, or increase seat count when the school needs broader coverage.",
  },
  {
    icon: Activity,
    title: "Clear code lifecycle",
    desc: "Codes move through Unused, Redeemed, Revoked, Replaced, or Expired states, so access remains auditable.",
  },
  {
    icon: Eye,
    title: "School visibility",
    desc: "Schools can log in to see seat usage, redeemed codes, and current or past subscription history without waiting for a manual report.",
  },
];

const lifecycle = ["Unused", "Redeemed", "Revoked", "Replaced", "Expired"];

const benefits = [
  "Monthly plans", "Three-month plans", "Six-month plans", "Yearly plans", "Custom plan duration",
  "Flexible student seat limits", "Secure one-time student activation", "Code revocation",
  "Code replacement", "Subscription renewal", "Subscription extension", "Centralized student access visibility",
];

export default function Home() {
  return (
    <div>
      <section className="max-w-6xl mx-auto px-4 pt-16 pb-20 grid lg:grid-cols-[1fr_0.9fr] gap-12 items-center">
        <div>
          <span className="badge text-cx-accent border-cx-accent/40 bg-cx-accent/10 mb-4">
            CensorX.ai Institute Portal
          </span>
          <h1 className="text-4xl md:text-5xl font-semibold leading-tight mb-4">
            Safer Digital Access for Every Student
          </h1>
          <p className="text-cx-muted mb-8 max-w-lg">
            CensorX helps schools and institutions provide students with AI-powered protection from harmful
            visual content and online harassment.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/contact" className="min-h-11 inline-flex items-center px-5 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium hover:opacity-90 transition-opacity">
              Partner With CensorX
            </Link>
            <Link to="/login" className="min-h-11 inline-flex items-center px-5 py-2.5 rounded-lg border border-cx-border hover:border-cx-accent/50 transition-colors">
              Institute Login
            </Link>
          </div>
        </div>

        <div className="glass-card p-6 md:p-7">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-11 w-11 rounded-lg border border-cx-accent/40 bg-cx-accent/10 flex items-center justify-center">
              <ShieldCheck className="text-cx-accent" size={22} />
            </div>
            <div>
              <p className="text-sm font-medium">Protection flow</p>
              <p className="text-xs text-cx-muted">From school subscription to student device</p>
            </div>
          </div>

          <div className="space-y-3">
            {[
              ["School subscription", "Plan duration and seat count are set up with CensorX."],
              ["Student codes", "Unique codes are generated for distribution."],
              ["Android activation", "Students redeem once to activate protection."],
            ].map(([title, desc], index) => (
              <div key={title} className="flex gap-3 rounded-lg border border-cx-border bg-white/5 p-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cx-accent2/10 text-sm font-semibold text-cx-accent2">
                  {index + 1}
                </div>
                <div>
                  <h3 className="font-medium">{title}</h3>
                  <p className="text-sm text-cx-muted">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {["Privacy-first", "Single-use codes", "School visibility"].map((item) => (
              <span key={item} className="badge border-cx-border bg-white/5 text-cx-muted">{item}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-16 border-t border-cx-border">
        <h2 className="text-2xl font-semibold mb-8 text-center">Institute Solution</h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
          {solutionCards.map(({ title, desc, icon: Icon }) => (
            <div key={title} className="glass-card p-5 transition-transform hover:-translate-y-1 hover:border-cx-accent/50">
              <div className="mb-4 h-11 w-11 rounded-lg border border-cx-accent/40 bg-cx-accent/10 flex items-center justify-center">
                <Icon className="text-cx-accent" size={22} />
              </div>
              <h3 className="font-medium mb-1">{title}</h3>
              <p className="text-sm text-cx-muted">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-16 border-t border-cx-border">
        <div className="max-w-3xl mx-auto text-center mb-10">
          <h2 className="text-2xl font-semibold mb-3">How School Subscriptions Work</h2>
          <p className="text-cx-muted">
            CensorX subscriptions are set up directly with each school, combining a plan duration,
            a seat count, and one-time activation codes that students redeem in the Android app.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
          {subscriptionItems.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="glass-card p-5">
              <Icon className="text-cx-accent2 mb-3" size={22} />
              <h3 className="font-medium mb-2">{title}</h3>
              <p className="text-sm text-cx-muted">{desc}</p>
            </div>
          ))}
        </div>

        <div className="glass-card p-5 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <h3 className="font-medium mb-2">Activation code lifecycle</h3>
              <p className="text-sm text-cx-muted max-w-xl">
                The portal keeps every code visible by state, so schools know what is ready to distribute,
                what is already in use, and what needs attention.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {lifecycle.map((item, index) => (
                <div key={item} className="flex items-center gap-2">
                  <span className="badge border-cx-border bg-white/5 text-cx-muted">{item}</span>
                  {index < lifecycle.length - 1 && <ArrowRight className="hidden sm:block text-cx-muted" size={16} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-16 border-t border-cx-border">
        <h2 className="text-2xl font-semibold mb-8 text-center">How It Works</h2>
        <ol className="max-w-2xl mx-auto space-y-4">
          {steps.map((step, idx) => (
            <li key={step} className="flex items-start gap-4">
              <span className="flex-none w-8 h-8 rounded-full bg-cx-accent/10 border border-cx-accent/40 text-cx-accent flex items-center justify-center text-sm font-medium">
                {idx + 1}
              </span>
              <span className="text-cx-muted pt-1">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-16 border-t border-cx-border">
        <h2 className="text-2xl font-semibold mb-8 text-center">Benefits for Schools</h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {benefits.map((b) => (
            <div key={b} className="glass-card px-4 py-3 text-sm text-cx-muted flex items-center gap-2">
              <CheckCircle2 className="text-cx-accent2 shrink-0" size={16} />
              {b}
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-20 border-t border-cx-border text-center">
        <h2 className="text-3xl font-semibold mb-4">Protect Your Students With CensorX</h2>
        <p className="text-cx-muted mb-6">Talk to CensorX about plans, seats, deployment, and school portal access.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/contact" className="min-h-11 inline-flex items-center px-5 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium hover:opacity-90 transition-opacity">
            Contact CensorX
          </Link>
          <Link to="/login" className="min-h-11 inline-flex items-center px-5 py-2.5 rounded-lg border border-cx-border hover:border-cx-accent/50 transition-colors">
            Institute Login
          </Link>
        </div>
      </section>
    </div>
  );
}
