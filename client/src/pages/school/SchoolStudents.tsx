import { type ReactNode, useEffect, useState } from "react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import Select from "../../components/Select";
import SearchBox from "../../components/SearchBox";
import Pagination from "../../components/Pagination";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { schoolNavItems } from "./navItems";

const statuses = ["ACTIVE", "REVOKED", "EXPIRED"] as const;

// Column layout shared by the header labels and every row on large screens.
const STUDENT_GRID = "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_7rem]";

interface StudentRow {
  studentName: string | null;
  studentIdentifier: string | null;
  parentName: string | null;
  parentEmail: string | null;
  deviceModel: string | null;
  status: string;
}

export default function SchoolStudents() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (search) params.set("search", search);
    if (status) params.set("status", status);

    apiClient.get<ApiResponse<PagedResult<StudentRow>>>(`/school/students?${params.toString()}`).then((res) => {
      if (res.data.success) {
        setStudents(res.data.data.items);
        setTotalPages(res.data.data.totalPages);
      }
    });
  }, [search, status, page]);

  return (
    <PortalLayout items={schoolNavItems}>
      <PageHeader title="Students" />

      <div className="mb-4 grid gap-3 sm:grid-cols-[220px_1fr]">
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="cx-input w-full"
        >
          <option value="">All statuses</option>
          {statuses.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </Select>
        <SearchBox>
          <input
            aria-label="Search student name or ID"
            placeholder="Search student name or ID"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="cx-input w-full pl-10"
          />
        </SearchBox>
      </div>

      {/* Students as row cards: stacked on phones, aligned columns on large screens */}
      {students.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-cx-muted">No records found.</div>
      ) : (
        <div>
          <div
            aria-hidden="true"
            className={`hidden gap-4 px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-cx-muted lg:grid ${STUDENT_GRID}`}
          >
            <span>Student</span>
            <span>Parent</span>
            <span>Device</span>
            <span>Status</span>
          </div>
          <ul className="space-y-2.5">
            {students.map((row, index) => {
              const initial =
                (row.studentName ?? row.studentIdentifier ?? "").trim().charAt(0).toUpperCase() || "?";
              return (
                <li
                  key={`${row.studentIdentifier ?? "student"}-${index}`}
                  className={`grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-2xl border border-cx-border bg-white px-4 py-3 transition duration-200 animate-fade-up hover:border-cx-accent/40 hover:shadow-card motion-reduce:animate-none motion-reduce:transition-none lg:items-center lg:gap-x-4 ${STUDENT_GRID}`}
                  style={{ animationDelay: `${index * 40}ms` }}
                >
                  <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 lg:col-span-1 lg:justify-start">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cx-dark text-sm font-bold text-white">
                        {initial}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-cx-heading">{row.studentName ?? "-"}</p>
                        <p className="truncate text-xs text-cx-muted">{row.studentIdentifier ?? "-"}</p>
                      </div>
                    </div>
                    <span className="lg:hidden">
                      <StatusBadge status={row.status} />
                    </span>
                  </div>

                  <div className="col-span-2 min-w-0 lg:col-span-1">
                    <Label>Parent</Label>
                    <p className="truncate text-sm text-cx-text">{row.parentName ?? "-"}</p>
                    <p className="truncate text-xs text-cx-muted">{row.parentEmail ?? "-"}</p>
                  </div>

                  <div className="col-span-2 min-w-0 lg:col-span-1">
                    <Label>Device</Label>
                    <p className="truncate text-sm text-cx-text">{row.deviceModel ?? "-"}</p>
                  </div>

                  <div className="hidden lg:block">
                    <StatusBadge status={row.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPage={setPage} />
    </PortalLayout>
  );
}

/** Small label shown on phones only; large screens use the column header. */
function Label({ children }: { children: ReactNode }) {
  return (
    <span className="block text-[10px] font-medium uppercase tracking-wider text-cx-muted lg:hidden">{children}</span>
  );
}
