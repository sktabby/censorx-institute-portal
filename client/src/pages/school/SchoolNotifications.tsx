import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlarmClock,
  Bell,
  CalendarPlus,
  CheckCheck,
  CircleAlert,
  KeyRound,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  TimerOff,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import PageHeader from "../../components/PageHeader";
import Pagination from "../../components/Pagination";
import { apiClient, type ApiResponse } from "../../api/client";
import { announceNotificationsChanged } from "../../hooks/useUnreadNotifications";
import { schoolNavItems } from "./navItems";

type NotificationType =
  | "BATCH_CREATED"
  | "BATCH_RENEWED"
  | "BATCH_ENDING_SOON"
  | "BATCH_ENDED"
  | "CODES_READY"
  | "BATCH_PAUSED"
  | "BATCH_RESUMED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_DUE"
  | "PAYMENT_OVERDUE";

interface NotificationRow {
  notificationId: string;
  type: NotificationType;
  title: string;
  message: string;
  subscriptionId: string | null;
  batchLabel: string | null;
  createdAt: string | null;
  readAt: string | null;
}

interface NotificationPage {
  items: NotificationRow[];
  total: number;
  unreadCount: number;
  page: number;
  totalPages: number;
}

const ICONS: Record<NotificationType, { icon: LucideIcon; tone: string }> = {
  BATCH_CREATED: { icon: CalendarPlus, tone: "bg-cx-tint text-cx-accent" },
  BATCH_RENEWED: { icon: RefreshCw, tone: "bg-cx-tint text-cx-accent" },
  CODES_READY: { icon: KeyRound, tone: "bg-cx-tint text-cx-accent" },
  BATCH_ENDING_SOON: { icon: AlarmClock, tone: "bg-amber-50 text-amber-700" },
  BATCH_ENDED: { icon: TimerOff, tone: "bg-red-50 text-red-700" },
  BATCH_PAUSED: { icon: PauseCircle, tone: "bg-red-50 text-red-700" },
  BATCH_RESUMED: { icon: PlayCircle, tone: "bg-cx-tint text-cx-accent" },
  PAYMENT_RECEIVED: { icon: Wallet, tone: "bg-cx-tint text-cx-accent" },
  PAYMENT_DUE: { icon: Wallet, tone: "bg-amber-50 text-amber-700" },
  PAYMENT_OVERDUE: { icon: CircleAlert, tone: "bg-red-50 text-red-700" },
};

/** Where a notice should take the school next: the batch's own page when there is one. */
function actionFor(row: NotificationRow): { label: string; to: string } | null {
  if (row.type === "CODES_READY") return { label: "Download codes", to: "/school/download-codes" };
  const to = row.subscriptionId ? `/school/subscription/${row.subscriptionId}` : "/school/subscription";
  if (row.type === "PAYMENT_RECEIVED") return { label: "View bill", to };
  if (row.type === "PAYMENT_DUE" || row.type === "PAYMENT_OVERDUE") return { label: "View payment", to };
  return { label: "View batch", to };
}

export default function SchoolNotifications() {
  const [data, setData] = useState<NotificationPage | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  async function load(nextPage = page) {
    const res = await apiClient.get<ApiResponse<NotificationPage>>(`/school/notifications?page=${nextPage}&pageSize=20`);
    if (res.data.success) {
      setData(res.data.data);
      announceNotificationsChanged(res.data.data.unreadCount);
    }
  }

  useEffect(() => {
    void load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function markAllRead() {
    setBusy(true);
    try {
      await apiClient.post("/school/notifications/read", {});
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function markRead(row: NotificationRow) {
    if (row.readAt) return;
    await apiClient.post("/school/notifications/read", { notificationIds: [row.notificationId] });
    await load();
  }

  return (
    <PortalLayout items={schoolNavItems}>
      <PageHeader
        title="Notifications"
        action={
          (data?.unreadCount ?? 0) > 0 ? (
            <button onClick={markAllRead} disabled={busy} className="cx-btn-secondary w-full sm:w-auto">
              <CheckCheck size={16} aria-hidden="true" />
              Mark all as read
            </button>
          ) : undefined
        }
      />

      <div className="mx-auto w-full max-w-3xl">
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-cx-line px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2.5">
              <Bell size={18} aria-hidden="true" className="text-cx-accent" />
              <h2 className="text-base font-semibold">Inbox</h2>
            </div>
            {data && (
              <span className="text-xs text-cx-muted">
                {data.unreadCount > 0 ? `${data.unreadCount} unread · ` : ""}
                {data.total} total
              </span>
            )}
          </div>
          {/* Fixed height: the list scrolls inside the box, the page stays put */}
          <div className="h-[26rem] overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin] sm:h-[32rem] sm:p-4">
        {!data ? (
          <p role="status" className="py-12 text-center text-sm text-cx-muted">Loading notifications...</p>
        ) : data.items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cx-tint text-cx-accent">
              <Bell size={22} aria-hidden="true" />
            </span>
            <p className="text-sm text-cx-muted">No notifications yet.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {data.items.map((row) => {
              const { icon: Icon, tone } = ICONS[row.type] ?? ICONS.BATCH_CREATED;
              const action = actionFor(row);
              const unread = !row.readAt;
              return (
                <li
                  key={row.notificationId}
                  className={`flex gap-3.5 rounded-2xl border p-4 transition-colors ${
                    unread ? "border-cx-accent/40 bg-cx-tint/40" : "border-cx-border bg-white"
                  }`}
                >
                  <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <h2 className="flex items-center gap-2 text-sm font-semibold text-cx-heading">
                        {unread && <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-cx-accent" />}
                        {row.title}
                      </h2>
                      <span className="text-xs text-cx-muted">{formatWhen(row.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-cx-text">{row.message}</p>
                    <div className="mt-1 flex flex-wrap gap-x-4">
                      {action && (
                        <Link
                          to={action.to}
                          onClick={() => void markRead(row)}
                          className="cx-link inline-flex min-h-11 items-center text-sm"
                        >
                          {action.label}
                        </Link>
                      )}
                      {unread && (
                        <button
                          onClick={() => void markRead(row)}
                          className="inline-flex min-h-11 items-center text-sm text-cx-muted hover:text-cx-text hover:underline"
                        >
                          Mark as read
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
          </div>
        </div>

        {data && data.totalPages > 1 && <Pagination page={page} totalPages={data.totalPages} onPage={setPage} />}

        <p className="mt-6 text-xs text-cx-muted">
          The same reminders are also emailed to your school's contact email. To renew a batch, write to{" "}
          <a href="mailto:team@censorx.in" className="cx-link">
            team@censorx.in
          </a>
          .
        </p>
      </div>
    </PortalLayout>
  );
}

function formatWhen(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
