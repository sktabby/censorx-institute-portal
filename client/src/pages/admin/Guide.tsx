import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, FilePlus, KeyRound, School, type LucideIcon } from "lucide-react";
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
    text: "Adds the school and emails its login. Do this once for each school. No dates or payment here.",
  },
  {
    label: "Subscription",
    to: "/admin/subscriptions",
    icon: FilePlus,
    text: "Adds a batch (dates, classes with their number of codes, payment and bill), or renews a batch. It never makes codes.",
  },
  {
    label: "Create Codes",
    to: "/admin/codes/create",
    icon: KeyRound,
    text: "Makes the codes for the classes that are waiting, and emails them to the school.",
  },
];

const cases: GuideCase[] = [
  {
    title: "A new school",
    text: "Set up a school and give every class its own codes.",
    steps: [
      "Go to Create School. Fill in the name, contact person, phone and email, then click Create School. The school gets its login by email.",
      "Click “Set up the first batch” (or go to Subscription and choose the school).",
      "Under “Add a new batch”, choose the plan length, start date and end date.",
      "Type the first class name (for example Class 5A) and exactly how many codes it needs (at most 2,000 per class).",
      "Click “Add class” for every other class. Use × to remove a row you do not need.",
      "Fill in the price: an amount per code per month (worked out for you as codes × price × months) or a typed amount, and a discount % if any.",
      "Enter the amount paid now and how it was paid. It is kept separate: the “Installments for the rest” split only what is left. Choose a due date for each installment (amounts split equally; type one and the others adjust). Click “Create Batch 1”.",
      "The school is emailed the batch details (classes and codes per class) and the invoice as a PDF.",
      "Go to Create Codes, choose the school, tick the classes (or “Select all”), choose Random codes (or From student IDs for one class) and click Create Codes.",
      "Download the codes as Excel if you need them. The school gets one email per class with its codes, and can also download them any time from Download Codes in its portal.",
    ],
    note: "A batch is one subscription: one set of dates, one bill. All its classes end together. For student IDs you can choose an Excel or CSV file (IDs in the first column); an ID already used in the school is refused.",
    links: [
      { label: "Create School", to: "/admin/schools/create" },
      { label: "Subscription", to: "/admin/subscriptions" },
      { label: "Create Codes", to: "/admin/codes/create" },
    ],
  },
  {
    title: "New classes later in the year",
    text: "A school wants more classes after it has started.",
    steps: [
      "Go to Subscription and choose the school.",
      "Under “Add a new batch”, set the dates for these classes. They can be different from the first batch.",
      "Add each new class with its number of codes, fill in the payment, and click “Create Batch 2” (the number goes up by itself).",
      "Go to Create Codes and make the codes for the new classes.",
    ],
    note: "The new batch has its own dates and bill. The school's first batch is not changed in any way.",
    links: [
      { label: "Subscription", to: "/admin/subscriptions" },
      { label: "Create Codes", to: "/admin/codes/create" },
    ],
  },
  {
    title: "Renewing a batch",
    text: "A batch is ending or has ended, and the school pays again.",
    steps: [
      "Go to Subscription and choose the school.",
      "Under “Renew or manage a batch”, find the batch and click “Renew Batch N”.",
      "Check the dates. If the batch has not ended yet, the new period starts on its current end date, so no paid days are lost.",
      "Fill in the renewal payment and click Renew.",
      "The school is emailed the new dates and the renewal bill. Students keep the same codes and just open the app again.",
      "After a batch has ended, the school gets a renewal email every 4 days until it renews. If the school asks you to stop, click “Stop renewal emails” on that batch.",
    ],
    note: "Only that batch is renewed. Every other batch keeps its own dates. A paused batch cannot be renewed: click “Restart access” first.",
    links: [{ label: "Subscription", to: "/admin/subscriptions" }],
  },
  {
    title: "One or two students join a class later",
    text: "For example, Class 5A gets 2 new students.",
    steps: [
      "Go to Subscription and choose the school.",
      "On the batch that has Class 5A, click “Add codes to a class”.",
      "Choose Class 5A and enter 2. The price is filled in: 2 codes × the batch's price per code per month × the months left. Change it if you like, or enter 0 for free codes.",
      "If the school pays now, tick “Paid now” and choose how it paid: the payment is recorded with the codes and no installment is added. Otherwise choose when the extra amount is due.",
      "Click “Add codes and send bill”. The batch's bill gets a new line for the 2 codes, and the school is emailed an updated bill. If it was not paid now, collect it later with “Record payment”.",
      "Go to Create Codes. Class 5A shows 2 codes waiting. Tick it and click Create Codes.",
    ],
    note: "This is only for a few extra students. For a new class, add a new batch. The first invoice is never changed; each change gets a new bill.",
    links: [
      { label: "Subscription", to: "/admin/subscriptions" },
      { label: "Create Codes", to: "/admin/codes/create" },
    ],
  },
  {
    title: "A family lost an unused code",
    text: "Replace a code that nobody has used yet.",
    steps: [
      "Go to Manage Codes and find the lost code. Its status is Unused.",
      "Click Replace on that row.",
      "If you like, type a reason. Then click “Replace code”.",
      "The new code is shown once. Click Copy code or Download, and give it to the family.",
      "Click Done. The old code no longer works.",
    ],
    note: "The new code stays in the same class and batch. A code in a batch that has ended cannot be replaced until the batch is renewed.",
    links: [{ label: "Manage Codes", to: "/admin/codes" }],
  },
  {
    title: "The school did not get the codes email",
    text: "Give the school its full codes again.",
    steps: [
      "Ask the school to open Download Codes in its portal. It can download every batch, one batch, or chosen classes as an Excel file.",
      "Or go to Manage Codes, choose the school (and a class name if you like), and click “Download full codes”.",
    ],
    note: "Codes made before secure storage was switched on show as “Not available”. For those, replace the unused codes.",
    links: [{ label: "Manage Codes", to: "/admin/codes" }],
  },
  {
    title: "A school pays the next installment",
    text: "Record the money and send the school its updated bill.",
    steps: [
      "Go to Subscription and choose the school.",
      "On the batch, in its Payment box, click “Record payment”.",
      "Check the amount (it is filled in with the next installment), the date received and how it was paid. Click “Record payment and send bill”.",
      "A new bill (the invoice number with -2, -3 …) is emailed to the school as a PDF and appears on its batch page. It shows the payments so far and the balance.",
      "To change the dates or amounts of the installments, click “Change installments”. If anything changed, a new bill replaces the earlier ones and is emailed to the school. Reminders follow the new dates.",
    ],
    note: "Due dates are set in the payment section when you create or renew a batch. The school is reminded 3 days before each date, on the date, and when it is a week late, then every 3 days until it is paid.",
    links: [{ label: "Subscription", to: "/admin/subscriptions" }],
  },
  {
    title: "A school does not pay",
    text: "Reminders go out automatically; stopping access is always your decision.",
    steps: [
      "Overdue installments are listed on the Dashboard under “Payments to collect”, and flagged on the Schools list.",
      "The school gets reminder emails and portal messages on its own: before the date, on the date, a week late, then a “still overdue” email every 3 days until it pays. Nothing is cut off automatically.",
      "If you decide to stop access, go to Subscription, choose the school and click “Stop access” on that batch. You can give a reason; the school sees it.",
      "Only that batch's students lose access. Their codes are kept, and other batches carry on.",
      "When they pay, record the payment, then click “Restart access”. The same codes work again straight away.",
    ],
    links: [
      { label: "Dashboard", to: "/admin" },
      { label: "Subscription", to: "/admin/subscriptions" },
    ],
  },
  {
    title: "Pausing, cancelling or removing",
    text: "Stop a school, one batch, or take the school off the list.",
    steps: [
      "To pause the whole school: open it from Schools and click Suspend. Click Reactivate to undo it.",
      "To pause one batch (for example, payment overdue): click “Stop access” on it, and “Restart access” to undo it.",
      "To end one batch for good: click “Cancel batch” on it. Its students lose access straight away and it cannot be renewed; other batches carry on.",
      "To remove the school: go to Manage Codes and use Delete Sheet (type the school name) until no active codes are left. Then go to Schools and click Delete. The school is archived: its login is removed and its records are kept.",
    ],
    links: [
      { label: "Schools", to: "/admin/schools" },
      { label: "Subscription", to: "/admin/subscriptions" },
    ],
  },
];

const goodToKnow = [
  "School status: Active while any batch is live, Expired only when every batch has ended. Suspended overrides both.",
  "A student's code works until the end date of its own class's batch. Another batch ending never cuts it short.",
  "Three days before a batch ends, the school gets an email and a notice in its portal. When it ends, it gets both again, then a renewal email every 4 days until it renews (you can stop these on the batch).",
  "Create Codes only shows classes waiting for codes in a live batch, including extra codes added to a class. If a class is not there, add it on the Subscription page.",
  "Each class name is used once per school, and a class can have at most 2,000 codes.",
  "A student ID can be used only once in a school, even after its code was revoked, replaced or deleted.",
  "Payments always settle the installment that is due first. The amount paid at the start (and extra codes paid on the spot) is kept separate from the installments.",
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
      <PageHeader title="Guide" />

      {/* One column, centred on desktop */}
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <section aria-labelledby="guide-overview">
          <h2 id="guide-overview" className="mb-1 text-xl font-semibold">
            How it works
          </h2>
          <p className="mb-4 text-sm text-cx-muted">
            Batches, dates and bills are set in <span className="font-medium text-cx-text">Subscription</span>. Codes are made in{" "}
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
