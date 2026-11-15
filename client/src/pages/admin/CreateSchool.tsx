import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import { apiClient, type ApiResponse } from "../../api/client";
import { adminNavItems } from "./navItems";

const createSchoolSchema = z.object({
  name: z.string().min(2, "Name is required."),
  contactName: z.string().min(2, "Contact person is required."),
  contactPhone: z.string().min(6, "Phone is required."),
  contactEmail: z.string().email("Enter a valid email address."),
});

const initial = {
  name: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
};

interface CreateSchoolResponse {
  organizationId: string;
}

/**
 * Creates the school and its login only. Dates, classes, seats and payment are
 * added per batch on the Subscription page.
 */
export default function CreateSchool() {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ organizationId: string; email: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  function update<K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = createSchoolSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.post<ApiResponse<CreateSchoolResponse>>("/admin/organizations", parsed.data);
      if (res.data.success) {
        setCreated({ organizationId: res.data.data.organizationId, email: parsed.data.contactEmail });
        setForm(initial);
      } else {
        setError(res.data.error.message);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Failed to create school.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PortalLayout items={adminNavItems}>
      <PageHeader title="Create School" />

      {created ? (
        <div className="cx-form-card max-w-3xl space-y-4">
          <p role="status" className="cx-alert-success">
            School created. The login details were emailed to {created.email}.
          </p>
          <p className="text-sm text-cx-muted">
            Next, set up its first batch: the dates, the classes with their number of codes, and the payment.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate(`/admin/subscriptions?school=${created.organizationId}`)}
              className="cx-btn-primary w-full sm:w-auto"
            >
              Set up the first batch
            </button>
            <Link to={`/admin/schools/${created.organizationId}`} className="cx-btn-secondary w-full sm:w-auto">
              Open school
            </Link>
            <button type="button" onClick={() => setCreated(null)} className="cx-btn-secondary w-full sm:w-auto">
              Create another school
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="cx-form-card max-w-3xl space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name" value={form.name} onChange={(v) => update("name", v)} />
            <Field label="Contact person" value={form.contactName} onChange={(v) => update("contactName", v)} />
            <Field label="Phone" value={form.contactPhone} onChange={(v) => update("contactPhone", v)} />
            <Field label="Email" type="email" value={form.contactEmail} onChange={(v) => update("contactEmail", v)} />
          </div>

          <p className="rounded-xl border border-cx-accent/20 bg-cx-tint px-3.5 py-2.5 text-sm text-cx-text">
            The email above becomes the school's login. A temporary password is sent to it. Payment is recorded per batch
            on the Subscription page.
          </p>

          {error && <p role="alert" className="cx-alert-error">{error}</p>}

          <button type="submit" disabled={submitting} className="cx-btn-primary w-full sm:w-auto">
            {submitting ? "Creating..." : "Create School"}
          </button>
        </form>
      )}
    </PortalLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="cx-label">{label}</span>
      <input type={type} required value={value} onChange={(e) => onChange(e.target.value)} className="cx-input mt-1 w-full" />
    </label>
  );
}
