import {
  ArrowRight,
  Bell,
  KeyRound,
  Layers,
  ListChecks,
  Lock,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  UserCheck,
  Users,
} from "lucide-react";

const features = [
  {
    icon: MessageSquare,
    title: "Harassment detection",
    desc: "Detects toxic, abusive, and threatening language patterns in real time across chats and messages.",
  },
  {
    icon: ShieldAlert,
    title: "Harmful content filtering",
    desc: "Reduces exposure to explicit, disturbing, and unsafe content that appears unexpectedly.",
  },
  {
    icon: Bell,
    title: "Real-time alerts",
    desc: "Notifies guardians and schools only when high-risk events occur, without creating constant noise.",
  },
  {
    icon: UserCheck,
    title: "Role-based protection",
    desc: "Protection adapts for parents, kids, students, and individuals using privacy-first defaults.",
  },
  {
    icon: KeyRound,
    title: "Secure Student Activation Codes",
    desc: "Each student receives a unique, cryptographically random activation code that can be redeemed once.",
  },
  {
    icon: Layers,
    title: "Flexible Institute Plans",
    desc: "Monthly, three-month, six-month, yearly, or custom subscription durations can be configured per school.",
  },
  {
    icon: Users,
    title: "Flexible Seat Limits",
    desc: "Schools can start with the seat count they need and increase coverage as more students are added.",
  },
  {
    icon: ListChecks,
    title: "Code Status Tracking",
    desc: "Unused, Redeemed, Revoked, Replaced, Deleted, and Expired statuses stay visible in the portal.",
  },
  {
    icon: RefreshCw,
    title: "Subscription Renewal and Extension",
    desc: "CensorX can renew plans, extend expiry dates, and increase seats without changing the school login flow.",
  },
  {
    icon: Smartphone,
    title: "Android Integration",
    desc: "Website-generated activation codes redeem directly in the CensorX Android app through the shared backend.",
  },
  {
    icon: Lock,
    title: "Secure School Access",
    desc: "Each School Admin can access only their assigned organization, codes, students, and subscription history.",
  },
];

export default function Features() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-16">
      <div className="max-w-3xl mx-auto text-center mb-12">
        <span className="badge text-cx-accent border-cx-accent/40 bg-cx-accent/10 mb-4">
          Features & capabilities
        </span>
        <h1 className="text-3xl md:text-4xl font-semibold mb-4">
          Everything you need for real-time protection - with privacy-first defaults.
        </h1>
        <p className="text-cx-muted">
          CensorX combines student activation workflows for schools with safety features designed to reduce
          exposure to harmful content and online harassment.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="group glass-card p-5 transition-transform hover:-translate-y-1 hover:border-cx-accent/50">
            <div className="mb-4 h-11 w-11 rounded-lg border border-cx-accent/40 bg-cx-accent/10 flex items-center justify-center">
              <Icon className="text-cx-accent" size={22} />
            </div>
            <h3 className="font-medium mb-2">{title}</h3>
            <p className="text-sm text-cx-muted mb-5">{desc}</p>
            <div className="mt-auto inline-flex items-center gap-2 text-sm text-cx-accent">
              Read more
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
