import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import PortalLayout from "../../layouts/PortalLayout";
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

export default function CreateSchool() {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  function update<K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const parsed = createSchoolSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient.post<ApiResponse<{ organizationId: string }>>("/admin/organizations", parsed.data);
      if (res.data.success) {
        const organizationId = res.data.data.organizationId;
        setMessage("School created and temporary password email sent.");
        setTimeout(() => navigate(`/admin/schools/${organizationId}`), 600);
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
      <h1 className="text-2xl font-semibold mb-6">Create School</h1>

      <form onSubmit={onSubmit} className="glass-card p-6 max-w-2xl space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Name" value={form.name} onChange={(v) => update("name", v)} />
          <Field label="Contact person" value={form.contactName} onChange={(v) => update("contactName", v)} />
          <Field label="Phone" value={form.contactPhone} onChange={(v) => update("contactPhone", v)} />
          <Field label="Email" type="email" value={form.contactEmail} onChange={(v) => update("contactEmail", v)} />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm text-cx-accent2">{message}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="px-5 py-2.5 rounded-lg bg-cx-accent text-cx-bg font-medium disabled:opacity-50"
        >
          {submitting ? "Creating..." : "Create School"}
        </button>
      </form>
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
    <div>
      <label className="text-sm text-cx-muted">{label}</label>
      <input
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-cx-border focus:border-cx-accent outline-none text-sm"
      />
    </div>
  );
}
