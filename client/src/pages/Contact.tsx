import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Globe, Mail, Phone, ShieldCheck, type LucideIcon } from "lucide-react";
import { apiClient, type ApiResponse } from "../api/client";

const planOptions = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "THREE_MONTHS", label: "Three months" },
  { value: "SIX_MONTHS", label: "Six months" },
  { value: "YEARLY", label: "Yearly" },
  { value: "CUSTOM", label: "Custom" },
];

const enquirySchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  instituteName: z.string().min(2, "School / institute name is required"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().min(6, "Enter a valid phone number"),
  studentCount: z.coerce.number().int().positive("Enter a valid number of students"),
  preferredPlan: z.enum(["MONTHLY", "THREE_MONTHS", "SIX_MONTHS", "YEARLY", "CUSTOM"]),
  message: z.string().min(2, "Please add a short message"),
  website: z.string().max(0).optional(), // honeypot
});

type EnquiryForm = z.infer<typeof enquirySchema>;

export default function Contact() {
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EnquiryForm>({ resolver: zodResolver(enquirySchema) });

  async function onSubmit(values: EnquiryForm) {
    setServerError(null);
    try {
      const res = await apiClient.post<ApiResponse<unknown>>("/public/institute-enquiries", values);
      if (res.data.success) {
        setSubmitted(true);
      } else {
        setServerError(res.data.error.message);
      }
    } catch {
      setServerError("We couldn't send your message right now. Please try again shortly.");
    }
  }

  if (submitted) {
    return (
      <section className="max-w-xl mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold mb-3">Thank you</h1>
        <p className="text-cx-muted">
          Your enquiry has been received. A member of the CensorX team will get back to you shortly.
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-6xl mx-auto px-4 py-16">
      <div className="max-w-3xl mx-auto text-center mb-10">
        <span className="badge text-cx-accent border-cx-accent/40 bg-cx-accent/10 mb-4">
          Privacy-first safety
        </span>
        <h1 className="text-3xl md:text-4xl font-semibold mb-3">Contact CensorX</h1>
        <p className="text-cx-muted">
          A privacy-first digital safety layer for real-time protection against harmful content and online harassment.
        </p>
      </div>

      <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-6 items-start">
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-lg border border-cx-accent/40 bg-cx-accent/10 flex items-center justify-center">
              <ShieldCheck className="text-cx-accent" size={22} />
            </div>
            <div>
              <h2 className="font-semibold mb-1">Talk to the CensorX team</h2>
              <p className="text-sm text-cx-muted">
                Ask about school plans, student seats, activation codes, onboarding, and portal access.
              </p>
            </div>
          </div>

          <ContactLink icon={Mail} label="Email" href="mailto:contact@censorx.in" value="contact@censorx.in" />
          <ContactLink icon={Phone} label="Phone" href="tel:+919820376923" value="+91 98203 76923" />
          <ContactLink icon={Phone} label="Phone" href="tel:+918454800911" value="+91 84548 00911" />
          <ContactLink icon={Globe} label="Website" href="https://censorx.in" value="censorx.in" />
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="glass-card p-6 space-y-4">
          {/* Honeypot - hidden from real users */}
          <input type="text" tabIndex={-1} autoComplete="off" {...register("website")} className="hidden" />

          <div>
            <label className="text-sm text-cx-muted">Full name</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none" {...register("fullName")} />
            {errors.fullName && <p className="text-xs text-red-400 mt-1">{errors.fullName.message}</p>}
          </div>

          <div>
            <label className="text-sm text-cx-muted">School or institute name</label>
            <input className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none" {...register("instituteName")} />
            {errors.instituteName && <p className="text-xs text-red-400 mt-1">{errors.instituteName.message}</p>}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-cx-muted">Email</label>
              <input className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none" {...register("email")} />
              {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label className="text-sm text-cx-muted">Phone</label>
              <input className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none" {...register("phone")} />
              {errors.phone && <p className="text-xs text-red-400 mt-1">{errors.phone.message}</p>}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-cx-muted">Number of students</label>
              <input type="number" className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none" {...register("studentCount")} />
              {errors.studentCount && <p className="text-xs text-red-400 mt-1">{errors.studentCount.message}</p>}
            </div>
            <div>
              <label className="text-sm text-cx-muted">Preferred plan</label>
              <select className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none" {...register("preferredPlan")}>
                {planOptions.map((p) => (
                  <option key={p.value} value={p.value} className="bg-cx-panel">
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm text-cx-muted">Message</label>
            <textarea rows={4} className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none" {...register("message")} />
            {errors.message && <p className="text-xs text-red-400 mt-1">{errors.message.message}</p>}
          </div>

          {serverError && <p className="text-sm text-red-400">{serverError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isSubmitting ? "Sending..." : "Send Enquiry"}
          </button>
        </form>
      </div>
    </section>
  );
}

function ContactLink({
  icon: Icon,
  label,
  href,
  value,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  value: string;
}) {
  return (
    <a href={href} className="flex min-h-11 items-center gap-3 rounded-lg border border-cx-border bg-white/5 px-3 py-2 hover:border-cx-accent/50 transition-colors">
      <Icon className="text-cx-accent2 shrink-0" size={18} />
      <span>
        <span className="block text-xs text-cx-muted">{label}</span>
        <span className="text-sm text-cx-text">{value}</span>
      </span>
    </a>
  );
}
