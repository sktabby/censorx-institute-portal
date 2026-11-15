import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  Bell,
  BookOpen,
  Building2,
  CalendarClock,
  FileDown,
  FilePlus,
  HelpCircle,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PlusCircle,
  Ticket,
  UserCircle,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import AppFooter from "../components/AppFooter";
import { useUnreadNotifications } from "../hooks/useUnreadNotifications";

interface NavItem {
  label: string;
  to: string;
}

// Icons are looked up by path so the nav item lists themselves stay untouched.
const NAV_ICONS: Record<string, LucideIcon> = {
  "/school": LayoutDashboard,
  "/school/codes": KeyRound,
  "/school/download-codes": FileDown,
  "/school/students": Users,
  "/school/subscription": CalendarClock,
  "/school/notifications": Bell,
  "/school/account": UserCircle,
  "/school/guide": BookOpen,
  "/admin": LayoutDashboard,
  "/admin/schools": Building2,
  "/admin/schools/create": PlusCircle,
  "/admin/codes": KeyRound,
  "/admin/codes/create": Ticket,
  "/admin/subscriptions": FilePlus,
  "/admin/account": UserCircle,
  "/admin/guide": BookOpen,
};

const STORAGE_KEY = "cx-sidebar-collapsed";
const DESKTOP_QUERY = "(min-width: 768px)";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function PortalLayout({ items, children }: { items: NavItem[]; children: ReactNode }) {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  // Every portal page mounts its own layout, so each page opens scrolled to the top
  // (including the first page after signing in).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // The mobile drawer closes by itself if the window grows to desktop width.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      if (query.matches) setDrawerOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Mobile drawer: close on Escape and lock page scroll while it is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  async function handleLogout() {
    await logout();
    setDrawerOpen(false);
    navigate("/login");
  }

  // Desktop collapse control lives inside the sidebar.
  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable: the choice simply is not remembered.
    }
  }

  const isAdmin = profile?.role === "SUPER_ADMIN";
  const portalTitle = isAdmin ? "Admin Portal" : "School Portal";
  const accountPath = items.find((item) => item.to.endsWith("/account"))?.to;
  const guidePath = items.find((item) => item.to.endsWith("/guide"))?.to;
  const notificationsPath = items.find((item) => item.to.endsWith("/notifications"))?.to;
  const unread = useUnreadNotifications(!!notificationsPath && profile?.role === "SCHOOL_ADMIN");
  // The Guide is reached from the "Need help?" button in the top bar, not from the sidebar.
  const sidebarItems = items.filter((item) => !item.to.endsWith("/guide"));
  const initial = (profile?.email ?? "").trim().charAt(0).toUpperCase() || "?";

  // Labels disappear only on desktop when collapsed; the mobile drawer always shows them.
  const hideLabel = collapsed ? "md:hidden" : "";

  return (
    <div className="min-h-screen bg-white">
      {drawerOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-cx-night/60 backdrop-blur-[2px] md:hidden"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside
        id="portal-sidebar"
        className={`cx-sidebar fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-hidden bg-gradient-to-b from-cx-dark via-[#073530] to-cx-night text-white shadow-[8px_0_32px_rgba(4,21,20,0.35)] transition-[width,transform,visibility] duration-200 ease-out motion-reduce:transition-none md:visible md:max-w-none md:translate-x-0 ${
          collapsed ? "md:w-[80px]" : "md:w-[264px]"
        } ${drawerOpen ? "visible translate-x-0" : "max-md:invisible -translate-x-full"}`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-16 -top-16 h-52 w-52 rounded-full bg-cx-bright/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -right-16 h-56 w-56 rounded-full bg-cx-bright/10 blur-3xl"
        />

        {/* Brand */}
        <div className="relative flex h-[72px] shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4">
          <div className={`flex min-w-0 items-center gap-3 ${collapsed ? "md:mx-auto" : ""}`}>
            <span className="relative inline-flex h-11 w-11 shrink-0 -rotate-6 items-center justify-center rounded-xl bg-cx-night shadow-[0_6px_20px_rgba(50,178,169,0.35)] ring-2 ring-cx-bright/80">
              <img src="/censorx-logo.png" alt="" className="h-7 w-7 object-contain" />
            </span>
            <span className={`flex min-w-0 flex-col leading-none ${hideLabel}`}>
              <span className="text-xl font-black tracking-tight text-white">
                Censor<span className="text-cx-bright">X</span>
              </span>
              <span className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.28em] text-white/70">
                <span aria-hidden="true" className="h-px w-4 bg-cx-bright" />
                for Schools
              </span>
            </span>
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="relative flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-5 text-sm">
          <p className={`px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40 ${hideLabel}`}>
            Menu
          </p>
          {sidebarItems.map((item) => {
            const Icon = NAV_ICONS[item.to] ?? LayoutDashboard;
            // A parent path (e.g. /school) must not stay highlighted on its child pages.
            const hasChildItem = sidebarItems.some((other) => other.to.startsWith(`${item.to}/`));
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={hasChildItem}
                title={item.label}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  `group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 ${
                    collapsed ? "md:justify-center md:px-0" : ""
                  } ${
                    isActive
                      ? "bg-white/10 font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                      : "text-white/70 hover:bg-white/[0.07] hover:text-white"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-cx-bright shadow-[0_0_10px_rgba(50,178,169,0.8)]"
                      />
                    )}
                    <Icon
                      size={20}
                      aria-hidden="true"
                      className={`shrink-0 transition-transform duration-200 group-hover:scale-110 motion-reduce:transition-none ${
                        isActive ? "text-cx-bright" : ""
                      }`}
                    />
                    <span className={`break-words ${hideLabel}`}>{item.label}</span>
                    {item.to === notificationsPath && unread > 0 && (
                      <span
                        aria-label={`${unread} unread`}
                        className={`ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-cx-bright px-1.5 text-[11px] font-bold text-cx-night ${
                          collapsed ? "md:absolute md:right-2 md:top-1.5 md:ml-0" : ""
                        }`}
                      >
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer: collapse, profile, logout */}
        <div className="relative shrink-0 space-y-2 border-t border-white/10 p-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-controls="portal-sidebar"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white md:flex md:justify-start"
          >
            {collapsed ? (
              <PanelLeftOpen size={20} aria-hidden="true" className="mx-auto shrink-0" />
            ) : (
              <>
                <PanelLeftClose size={20} aria-hidden="true" className="shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>

          <div
            className={`flex items-center gap-3 rounded-xl bg-white/[0.06] p-2.5 ring-1 ring-white/10 ${
              collapsed ? "md:justify-center md:p-2" : ""
            }`}
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cx-night text-sm font-bold text-white ring-1 ring-cx-bright/60">
              {initial}
            </span>
            <div className={`min-w-0 ${hideLabel}`}>
              <p className="break-words text-xs font-medium text-white" title={profile?.email}>
                {profile?.email}
              </p>
              <p className="text-[11px] text-white/50">{isAdmin ? "Super Admin" : "School Admin"}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            title="Logout"
            aria-label="Logout"
            className={`cx-btn-outline-light w-full min-h-11 ${collapsed ? "md:px-0" : ""}`}
          >
            <LogOut size={16} aria-hidden="true" />
            <span className={hideLabel}>Logout</span>
          </button>
        </div>
      </aside>

      <div
        className={`flex min-h-screen min-w-0 flex-col transition-[padding] duration-200 ease-out motion-reduce:transition-none ${
          collapsed ? "md:pl-[80px]" : "md:pl-[264px]"
        }`}
      >
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-cx-border bg-white/90 px-4 backdrop-blur sm:px-6 md:px-8">
          <button
            type="button"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={drawerOpen}
            aria-controls="portal-sidebar"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cx-border text-cx-text transition-colors hover:border-cx-accent/40 hover:bg-cx-tint active:bg-cx-tint2 md:hidden"
          >
            <Menu size={20} aria-hidden="true" />
          </button>

          <span className="min-w-0 break-words text-base font-bold leading-tight tracking-tight text-cx-heading sm:text-lg">{portalTitle}</span>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {notificationsPath && (
              <Link
                to={notificationsPath}
                aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
                title="Notifications"
                className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-cx-border bg-white text-cx-text transition-colors hover:border-cx-accent/40 hover:bg-cx-tint"
              >
                <Bell size={18} aria-hidden="true" className="text-cx-accent" />
                {unread > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-5 text-white ring-2 ring-white"
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            )}
            {guidePath && (
              <Link
                to={guidePath}
                aria-label="Need help?"
                title="Need help?"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cx-border bg-white px-3 text-sm font-medium text-cx-text transition-colors hover:border-cx-accent/40 hover:bg-cx-tint"
              >
                <HelpCircle size={18} aria-hidden="true" className="text-cx-accent" />
                <span className="hidden sm:inline">Need help?</span>
              </Link>
            )}
            {accountPath && (
              <Link
                to={accountPath}
                aria-label="Account"
                title={profile?.email}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-cx-dark text-base font-bold text-white ring-2 ring-cx-accent/25 transition hover:ring-cx-accent/60"
              >
                {initial}
              </Link>
            )}
          </div>
        </header>

        <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 p-4 sm:p-6 md:p-8">{children}</main>
        <AppFooter />
      </div>
    </div>
  );
}
