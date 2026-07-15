import { useEffect, useState } from "react";
import PortalLayout from "../../layouts/PortalLayout";
import DataTable from "../../components/DataTable";
import StatusBadge from "../../components/StatusBadge";
import { apiClient, type ApiResponse, type PagedResult } from "../../api/client";
import { schoolNavItems } from "./navItems";

const statuses = ["ACTIVE", "REVOKED", "EXPIRED"] as const;

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
      <h1 className="text-2xl font-semibold mb-6">Students</h1>

      <div className="grid md:grid-cols-[220px_1fr] gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
        >
          <option value="" className="bg-cx-panel">All statuses</option>
          {statuses.map((item) => (
            <option key={item} value={item} className="bg-cx-panel">{item}</option>
          ))}
        </select>
        <input
          placeholder="Search student name or ID"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-cx-border text-sm"
        />
      </div>

      <DataTable
        rows={students}
        columns={[
          { header: "Student Name", render: (row) => row.studentName ?? "-" },
          { header: "Student ID", render: (row) => row.studentIdentifier ?? "-" },
          { header: "Parent Name", render: (row) => row.parentName ?? "-" },
          { header: "Parent Email", render: (row) => row.parentEmail ?? "-" },
          { header: "Device", render: (row) => row.deviceModel ?? "-" },
          { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
        ]}
      />

      <Pagination page={page} totalPages={totalPages} onPage={setPage} />
    </PortalLayout>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center gap-3 mt-4 text-sm">
      <button
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-3 py-1.5 rounded-lg border border-cx-border disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-cx-muted">Page {page} of {totalPages}</span>
      <button
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-3 py-1.5 rounded-lg border border-cx-border disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
