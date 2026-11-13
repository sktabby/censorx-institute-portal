import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, KeyRound, RefreshCw, School, type LucideIcon } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import { adminNavItems } from "./navItems";

interface GuideCase {
  title: string;
  text: string;
  steps: string[];
  note?: string;
  links: { label: string; to: string }[];
}

const overview: { label: string; to: string; icon: LucideIcon; text: string }[] = [
  {
    label: "Create School",
    to: "/admin/schools/create",
    icon: School,
    text: "Adds the school, its login and its first bill. Do this once for each school.",
  },
  {
    label: "Renew School",
    to: "/admin/subscriptions",
    icon: RefreshCw,
    text: "Sets the seats and the dates. Use it to start a plan, add a class, or renew. It never makes codes.",
  },
  {
    label: "Create Codes",
    to: "/admin/codes/create",
    icon: KeyRound,
    text: "Makes the codes and emails them to the school.",
  },
];

const cases: GuideCase[] = [
  {
    title: "A new school, with one sheet for each class",
    text: "Set up a school and give every class its own codes.",
    steps: [
      "Go to Create School. Fill in the school details and the payment, then click Create School.",
      "Go to Renew School and choose the school.",
      "Tick “Add a new class or extra seats”. Type the first class name (for example Class 5A) and its number of seats.",
      "Click “Add another class” for every other class, and fill in its name and seats. Use the × button to remove a row you do not need.",
      "Choose the plan length, start date and end date, then click Renew.",
      "Go to Create Codes and choose the school.",
      "Under Code sheet, choose one class that says “seats waiting”. Keep “Random codes” selected and click Create Codes.",
      "The school gets an email with that class's codes. Click Download CSV if you want your own copy. You cannot see the full codes again.",
      "Repeat steps 5 and 6 for each class that is still waiting.",
    ],
    note: "You can add all the classes at once. Make the codes one class at a time, and always pick the class from the waiting list, not “New sheet”.",
    links: [
      { label: "Create School", to: "/admin/schools/create" },
      { label: "Renew School", to: "/admin/subscriptions" },
      { label: "Create Codes", to: "/admin/codes/create" },
    ],
  },
  {
    title: "Adding a new class later",
    text: "A school has started and wants one or more extra classes.",
    steps: [
      "Go to Renew School and choose the school.",
      "Tick “Add a new class or extra seats”. Type the class name and the number of seats. Click “Add another class” if there is more than one.",
      "Use the same end date as the other classes if you want them to finish together. Click Renew. Leave the old sheets unticked.",
      "Go to Create Codes and choose the school.",
      "Choose the new class under “Waiting for codes”, then click Create Codes.",
    ],
    links: [
      { label: "Renew School", to: "/admin/subscriptions" },
      { label: "Create Codes", to: "/admin/codes/create" },
    ],
  },
  {
    title: "The plan has ended, so renew every class",
    text: "Give all the classes another year with the same codes.",
    steps: [
      "Go to Renew School and choose the school.",
      "Click “Select all renewable”. All the class sheets are ticked.",
      "Do not tick “Add a new class or extra seats”.",
      "Choose the new plan length, start date and end date.",
      "Check the line that says “Total seats after this”. It should match the total of your classes.",
      "Click Renew.",
    ],
    note: "Students keep the same codes and just open the app again. The school gets a short email with no new codes.",
    links: [{ label: "Renew School", to: "/admin/subscriptions" }],
  },
  {
    title: "Renewing only some classes",
    text: "One class is leaving, or you only want to renew a few.",
    steps: [
      "Go to Renew School and choose the school.",
      "Tick only the sheets you want to renew. Untick the others.",
      "Choose the dates and click Renew.",
    ],
    note: "Sheets you leave out stay ended and stop counting as seats.",
    links: [{ label: "Renew School", to: "/admin/subscriptions" }],
  },
  {
    title: "A class needs more students",
    text: "For example, Class 5A has 4 new students.",
    steps: [
      "Go to Renew School and choose the school.",
      "Tick “Add a new class or extra seats”. Name it something like “Class 5A extra” and enter 4 seats. Leave the other sheets unticked.",
      "Click Renew.",
      "Go to Create Codes. Choose “Class 5A extra” under “Waiting for codes” and click Create Codes.",
    ],
    note: "An existing sheet cannot grow, so extra students always get their own small sheet.",
    links: [
      { label: "Renew School", to: "/admin/subscriptions" },
      { label: "Create Codes", to: "/admin/codes/create" },
    ],
  },
  {
    title: "A family lost an unused code",
    text: "Replace a code that nobody has used yet.",
    steps: [
      "Go to Manage Codes, find the code and click Delete.",
      "Go to Create Codes and choose the school.",
      "Look at “Seats left to make codes for”. It must say 1. If it says more, stop and ask for help.",
      "Under Code sheet, choose the class under “Existing sheets”. Keep “Random codes” and click Create Codes.",
    ],
    note: "The school is emailed the new code.",
    links: [
      { label: "Manage Codes", to: "/admin/codes" },
      { label: "Create Codes", to: "/admin/codes/create" },
    ],
  },
  {
    title: "A student left and the seat should go to someone else",
    text: "Free the seat, then make one new code.",
    steps: [
      "Go to Manage Codes, find the student's code and click Delete. Their access stops straight away, so only do this when you are sure.",
      "Then follow the last three steps of “A family lost an unused code” to make one new code.",
    ],
    links: [
      { label: "Manage Codes", to: "/admin/codes" },
      { label: "Create Codes", to: "/admin/codes/create" },
    ],
  },
  {
    title: "Pausing or removing a school",
    text: "Stop a school for a while, or take it off the list.",
    steps: [
      "To pause: open the school from Schools and click Suspend. Click Reactivate to undo it.",
      "To end the plan: go to Renew School, choose the school and click “Cancel plan” at the bottom.",
      "To remove the school: go to Manage Codes and use Delete Sheet (type the school name) until no active codes are left. Then go to Schools and click Delete.",
    ],
    links: [
      { label: "Schools", to: "/admin/schools" },
      { label: "Manage Codes", to: "/admin/codes" },
    ],
  },
];

const goodToKnow = [
  "If a class is waiting for codes, always choose it in Create Codes. Do not choose “New sheet”, because it can use up that class's seats.",
  "Seats only come from Renew School. If Create Codes says there are no seats left, go there.",
  "Use the same start and end dates for every class, so they all end together.",
  "Full codes are shown only once, right after you create them, and in the email to the school.",
  "Deleting a code stops that student's access straight away.",
];

/** One case: a short line, and the numbered steps behind a Show steps / Hide steps button. */
function CaseCard({ item, index }: { item: GuideCase; index: number }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="rounded-2xl border border-cx-border bg-white p-4 transition-colors duration-200 hover:border-cx-accent/40">
      <div className="flex gap-3.5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cx-dark text-sm font-bold text-white">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-cx-heading">{item.title}</h3>
          <p className="mt-0.5 text-sm text-cx-muted">{item.text}</p>
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
          <ol className="space-y-2.5 pt-4 sm:pl-[50px]">
            {item.steps.map((step, stepIndex) => (
              <li key={step} className="flex gap-3 text-sm leading-relaxed text-cx-text">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cx-tint text-[11px] font-bold text-cx-accent ring-1 ring-cx-accent/20">
                  {stepIndex + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {item.note && (
            <p className="mt-3 rounded-xl border border-cx-accent/20 bg-cx-tint px-3.5 py-2.5 text-sm text-cx-text sm:ml-[50px]">
              {item.note}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 sm:pl-[50px]">
            {item.links.map((link) => (
              <Link key={link.to} to={link.to} className="cx-link inline-flex min-h-11 items-center gap-1 text-sm">
                {link.label} <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 sm:pl-[50px]">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-cx-accent transition-colors hover:text-cx-hover"
        >
          {open ? "Hide steps" : "Show steps"}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
    </div>
  );
}

export default function Guide() {
  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader title="Guide" description="How to set up, renew and manage schools." />

      {/* One column, centred on desktop */}
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <section aria-labelledby="guide-overview">
          <h2 id="guide-overview" className="mb-1 text-xl font-semibold">
            How it works
          </h2>
          <p className="mb-4 text-sm text-cx-muted">
            Seats and dates are set in <span className="font-medium text-cx-text">Renew School</span>. Codes are made in{" "}
            <span className="font-medium text-cx-text">Create Codes</span>.
          </p>
          <div className="grid gap-3">
            {overview.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="group flex gap-3.5 rounded-2xl border border-cx-border bg-white p-4 transition duration-200 hover:-translate-y-0.5 hover:border-cx-accent/40 hover:shadow-card motion-reduce:transition-none"
                >
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cx-dark text-white">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-cx-heading group-hover:text-cx-accent">{item.label}</span>
                    <span className="mt-0.5 block text-sm text-cx-muted">{item.text}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="guide-cases">
          <h2 id="guide-cases" className="mb-4 text-xl font-semibold">
            Step by step
          </h2>
          <div className="grid gap-3">
            {cases.map((item, index) => (
              <CaseCard key={item.title} item={item} index={index} />
            ))}
          </div>
        </section>

        <section aria-labelledby="guide-know">
          <h2 id="guide-know" className="mb-4 text-xl font-semibold">
            Good to know
          </h2>
          <ul className="glass-card space-y-3 p-4 sm:p-6">
            {goodToKnow.map((line) => (
              <li key={line} className="flex gap-3 text-sm leading-relaxed text-cx-text">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cx-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PortalLayout>
  );
}
