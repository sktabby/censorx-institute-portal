import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck, CalendarClock, GraduationCap, Hash, KeyRound, Layers } from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import StatTile from "../../components/StatTile";
import CountUp from "../../components/CountUp";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse } from "../../api/client";
import { schoolNavItems } from "./navItems";

interface RecentActivation {
  licenseId: string;
  studentName: string | null;
  studentIdentifier: string | null;
  studentEmail: string | null;
  redeemedAt: string | null;
  status: string;
}

/** Dates arrive either as ISO strings or as serialised Firestore timestamps. */
type AnyDate = { _seconds?: number; seconds?: number } | string | null;

interface Dashboard {
  schoolName: string;
  subscriptionStatus: string;
  subscriptionDisplayStatus: string;
  plan: string | null;
  planDuration: string | null;
  expiresAt?: AnyDate;
  totalSeats: number;
  totalStudentSeats: number;
  activatedSeats: number;
  totalRedeemedStudents: number;
  availableSeats: number;
  unusedCodes: number;
  revokedCodes: number;
  recentActivations: RecentActivation[];
}

// Geometry of the seat-usage ring (radius 44 in a 100x100 viewBox).
const RING_RADIUS = 44;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export default function SchoolDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    apiClient.get<ApiResponse<Dashboard>>("/school/dashboard").then((res) => {
      if (res.data.success) setData(res.data.data);
    });
  }, []);

  const seatUsage = useMemo(() => {
    const totalSeats = data?.totalStudentSeats ?? data?.totalSeats ?? 0;
    const usedSeats = data?.totalRedeemedStudents ?? data?.activatedSeats ?? 0;
    const percent = totalSeats > 0 ? Math.min(100, Math.round((usedSeats / totalSeats) * 100)) : 0;
    return { totalSeats, usedSeats, percent };
  }, [data]);

  const plan = data?.planDuration ?? data?.plan ?? "No plan";
  const status = data?.subscriptionStatus ?? "NONE";
  // Only the five most recent activations are listed; the full list lives on Students.
  const recent = (data?.recentActivations ?? []).slice(0, 5);

  return (
    <PortalLayout items={schoolNavItems}>
      {/* Hero */}
      <section className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-[#0c1211] via-[#070c0b] to-black p-5 text-white shadow-[0_14px_36px_rgba(0,0,0,0.35)] ring-1 ring-white/10 animate-fade-up motion-reduce:animate-none sm:p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-14 h-56 w-56 rounded-full bg-cx-bright/10 blur-3xl animate-float motion-reduce:animate-none"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:22px_22px]"
        />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <StatusBadge status={status} tone="dark" />
              <span className="text-sm text-white/70">Current plan: {formatPlan(plan)}</span>
            </div>
            <h1 className="mt-4 break-words font-serif text-3xl font-semibold italic leading-tight tracking-tight sm:text-4xl">
              <span className="bg-gradient-to-r from-white via-white to-cx-bright bg-clip-text text-transparent">
                {data?.schoolName ?? "Dashboard"}
              </span>
            </h1>
            <span aria-hidden="true" className="mt-3 block h-1 w-16 rounded-full bg-gradient-to-r from-cx-bright to-transparent" />
          </div>

          <div className="flex items-center gap-5">
            <div className="relative h-24 w-24 shrink-0 sm:h-28 sm:w-28">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
                <circle cx="50" cy="50" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r={RING_RADIUS}
                  fill="none"
                  stroke="#32b2a9"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={RING_LENGTH}
                  strokeDashoffset={RING_LENGTH * (1 - seatUsage.percent / 100)}
                  className="transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold leading-none text-white">
                  <CountUp value={seatUsage.percent} />%
                </span>
                <span className="mt-1 text-[10px] uppercase tracking-wider text-white/70">used</span>
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-white/70">Seat usage</p>
              <p className="text-2xl font-bold text-white">
                {seatUsage.usedSeats} <span className="text-base font-medium text-white/60">of {seatUsage.totalSeats}</span>
              </p>
              <p className="mt-1 text-xs text-white/70">{data?.availableSeats ?? 0} seats available</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stat tiles: two per row on phones, four on desktop */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Plan" value={formatPlan(plan)} icon={<Layers size={20} />} delay={0} />
        <StatTile label="Valid until" value={formatExpiry(data?.expiresAt)} icon={<CalendarClock size={20} />} delay={80} />
        <StatTile
          label="Redeemed students"
          value={<CountUp value={seatUsage.usedSeats} />}
          icon={<GraduationCap size={20} />}
          delay={160}
        />
        <StatTile
          label="Unused codes"
          value={<CountUp value={data?.unusedCodes ?? 0} />}
          icon={<KeyRound size={20} />}
          delay={240}
        />
      </div>

      {/* Recent activations as a timeline of cards */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Recent Activations</h2>
          <Link to="/school/students" className="cx-link inline-flex min-h-11 items-center gap-1 text-sm">
            View all <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>

        <div className="glass-card p-4 sm:p-6">
          {recent.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cx-tint text-cx-accent">
                <GraduationCap size={22} aria-hidden="true" />
              </span>
              <p className="text-sm text-cx-muted">No activations yet.</p>
            </div>
          ) : (
            <ol>
              {recent.map((row, index) => {
                const name = row.studentName ?? row.studentIdentifier ?? row.studentEmail ?? "Student";
                return (
                  <li
                    key={row.licenseId}
                    className="group relative flex gap-3.5 pb-4 animate-fade-up motion-reduce:animate-none last:pb-0 sm:gap-4"
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 left-[21px] top-12 w-0.5 rounded bg-cx-tint2 group-last:hidden"
                    />
                    <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cx-dark text-base font-bold text-white ring-4 ring-white">
                      {name.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    <div className="min-w-0 flex-1 rounded-2xl border border-cx-border bg-white p-3.5 transition duration-200 hover:-translate-y-0.5 hover:border-cx-accent/40 hover:shadow-card motion-reduce:transition-none">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                        <p className="min-w-0 truncate font-semibold text-cx-heading">{name}</p>
                        <StatusBadge status={row.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-cx-muted">
                        <span className="inline-flex items-center gap-1.5">
                          <Hash size={13} aria-hidden="true" className="text-cx-accent" />
                          {row.studentIdentifier ?? "-"}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarCheck size={13} aria-hidden="true" className="text-cx-accent" />
                          Redeemed {formatDate(row.redeemedAt)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}

function formatPlan(value: string | null) {
  if (!value) return "-";
  return value.replace(/_/g, " ");
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "-";
}

function formatExpiry(value: AnyDate | undefined) {
  if (!value) return "-";
  const date =
    typeof value === "string"
      ? new Date(value)
      : (value._seconds ?? value.seconds)
        ? new Date((value._seconds ?? value.seconds ?? 0) * 1000)
        : null;
  if (!date || Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
