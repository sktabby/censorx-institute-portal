import { useId, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { schoolNavItems } from "./navItems";

const SUPPORT_EMAIL = "team@censorx.in";

interface GuidePage {
  label: string;
  to: string;
  icon: LucideIcon;
  text: string;
  more: string[];
}

const pages: GuidePage[] = [
  {
    label: "Dashboard",
    to: "/school",
    icon: LayoutDashboard,
    text: "Your school at a glance.",
    more: [
      "This is the first page you see after signing in. At the top you will find your school name, your plan and how many seats are in use.",
      "Below that are four quick boxes: your Plan, the Valid until date, how many students have joined, and how many codes are still unused.",
      "At the bottom you can see the five students who joined most recently. Choose View all to see everyone.",
    ],
  },
  {
    label: "Student Codes",
    to: "/school/codes",
    icon: KeyRound,
    text: "All the codes given to your school.",
    more: [
      "Every code is listed with its status, the batch it belongs to, the student who used it, and the dates it was created and used. For safety, only the last digits of each code are shown.",
      "Use the search box to find a code or a student ID. Use the status filter to see, for example, only the codes that are not used yet.",
      "Choose Download to save the codes on your screen as a spreadsheet file. You will be asked for your password first. The full codes are in the email CensorX sent to your school.",
    ],
  },
  {
    label: "Students",
    to: "/school/students",
    icon: GraduationCap,
    text: "Everyone who has joined.",
    more: [
      "When a family enters a code in the CensorX app, the student appears here.",
      "You can see the student's name and ID, the parent's name and email, the device they use, and whether they are Active, Expired or Revoked.",
      "Search by name or ID to find a student quickly, or filter by status.",
    ],
  },
  {
    label: "Subscription",
    to: "/school/subscription",
    icon: CalendarClock,
    text: "Your plan and seats.",
    more: [
      "See your current plan, its status, the total number of seats and how many are still free.",
      "The history below lists every plan your school has had, with the start date, end date and number of seats.",
      `To renew, extend or add more seats, write to ${SUPPORT_EMAIL}.`,
    ],
  },
  {
    label: "Account",
    to: "/school/account",
    icon: UserCircle,
    text: "Your details and password.",
    more: [
      "Check the school name, school ID and admin email linked to your login.",
      "You can change your password here at any time. If you are asked to set a new password after your first sign in, this is where to do it.",
      "Forgot your password? Choose Forgot Password on the sign-in page and we will email you a reset link.",
    ],
  },
];

const statuses = [
  { status: "UNUSED", text: "Not used yet." },
  { status: "REDEEMED", text: "Used by a student." },
  { status: "EXPIRED", text: "The plan period has ended." },
  { status: "REVOKED", text: "Withdrawn by CensorX." },
  { status: "REPLACED", text: "Swapped for a new code." },
  { status: "DELETED", text: "Removed by CensorX." },
];

const faqs = [
  {
    q: "Where do I see how many students have joined?",
    a: "On Dashboard, the Redeemed students tile shows the total. The Students page lists each student.",
  },
  {
    q: "Where can I find my activation codes?",
    a: "Student Codes shows every code, but only the last digits are visible. The full codes are in the email CensorX sent to your school.",
  },
  {
    q: "How do I download my codes list?",
    a: "Open Student Codes, choose Download and enter your password. You get a spreadsheet file of the codes currently on the page. Codes in this file are masked.",
  },
  {
    q: "How do I add more students or seats, or renew my plan?",
    a: `Please contact CensorX at ${SUPPORT_EMAIL}. The Subscription page shows your current plan and seats.`,
  },
  {
    q: "What does “Valid until” mean?",
    a: "It is the date your current plan ends.",
  },
  {
    q: "A code does not work. What should I check?",
    a: "Look up the code in Student Codes. Redeemed means it was already used. Expired means the plan has ended. If it says Revoked or Deleted, contact us.",
  },
  {
    q: "How do I change or reset my password?",
    a: "To change it, go to Account and use Change Password. If you forgot it, choose Forgot Password on the sign-in page and we will email you a reset link.",
  },
];

/** One page of the portal, with a short line and a Read more / Read less detail panel. */
function PageCard({ page }: { page: GuidePage }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const Icon = page.icon;

  return (
    <div className="rounded-2xl border border-cx-border bg-white p-4 transition-colors duration-200 hover:border-cx-accent/40">
      <div className="flex gap-3.5">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cx-dark text-white">
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-cx-heading">{page.label}</h3>
          <p className="mt-0.5 text-sm text-cx-muted">{page.text}</p>
        </div>
      </div>

      <div
        id={panelId}
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 pt-3 text-sm leading-relaxed text-cx-muted sm:pl-[54px]">
            {page.more.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 sm:pl-[54px]">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-cx-accent transition-colors hover:text-cx-hover"
        >
          {open ? "Read less" : "Read more"}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
        <Link to={page.to} className="cx-link inline-flex min-h-11 items-center gap-1 text-sm">
          Open page <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export default function Guide() {
  return (
    <PortalLayout items={schoolNavItems}>
      <PageHeader title="Guide" description="A quick guide to using CensorX for Schools." />

      {/* One column, centred on desktop */}
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <section aria-labelledby="guide-pages">
          <h2 id="guide-pages" className="mb-4 text-xl font-semibold">
            What each page does
          </h2>
          <div className="grid gap-3">
            {pages.map((page) => (
              <PageCard key={page.to} page={page} />
            ))}
          </div>
        </section>

        <section aria-labelledby="guide-statuses">
          <h2 id="guide-statuses" className="mb-4 text-xl font-semibold">
            Code statuses
          </h2>
          <ul className="glass-card space-y-3 p-4 sm:p-6">
            {statuses.map((item) => (
              <li key={item.status} className="flex items-center gap-3">
                <span className="w-24 shrink-0">
                  <StatusBadge status={item.status} />
                </span>
                <span className="text-sm text-cx-muted">{item.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="guide-faq">
          <h2 id="guide-faq" className="mb-4 text-xl font-semibold">
            Frequently asked questions
          </h2>
          <div className="space-y-3">
            {faqs.map((item) => (
              <details
                key={item.q}
                className="group rounded-2xl border border-cx-border bg-white transition-colors open:border-cx-accent/40 open:shadow-card"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold text-cx-heading focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cx-accent [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown
                    size={18}
                    aria-hidden="true"
                    className="shrink-0 text-cx-accent transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                  />
                </summary>
                <p className="px-4 pb-4 text-sm leading-relaxed text-cx-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Support */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cx-mid via-cx-dark to-cx-night p-5 text-white shadow-teal ring-1 ring-white/10 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-cx-bright ring-1 ring-white/15">
                <LifeBuoy size={22} aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-white">Still need help?</h2>
                <p className="mt-1 text-sm text-white/80">Write to us and we will get back to you.</p>
              </div>
            </div>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="cx-btn-light w-full min-h-11 sm:w-auto">
              <Mail size={16} aria-hidden="true" />
              {SUPPORT_EMAIL}
            </a>
          </div>
        </section>
      </div>
    </PortalLayout>
  );
}
