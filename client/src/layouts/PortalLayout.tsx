import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LogOut, Menu, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

interface NavItem {
  label: string;
  to: string;
}

export default function PortalLayout({ items, children }: { items: NavItem[]; children: ReactNode }) {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function handleLogout() {
    await logout();
    setDrawerOpen(false);
    navigate("/login");
  }

  return (
    <div className="min-h-screen md:flex">
      {drawerOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-cx-border bg-cx-panel transition-transform duration-200 md:static md:z-auto md:w-60 md:translate-x-0 md:bg-cx-panel/40 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-16 flex items-center justify-between gap-2 px-5 font-semibold border-b border-cx-border">
          <div className="flex items-center gap-2">
            <img src="/censorx-logo.png" alt="" className="h-6 w-6 object-contain" />
            CensorX.ai
          </div>
          <button
            type="button"
            className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg text-cx-muted hover:text-cx-text hover:bg-white/5"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1 text-sm">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setDrawerOpen(false)}
              className={({ isActive }) =>
                `min-h-11 flex items-center px-3 py-2 rounded-lg transition-colors ${
                  isActive ? "bg-cx-accent/10 text-cx-accent" : "text-cx-muted hover:text-cx-text"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-cx-border text-sm">
          <div className="px-3 pb-2 text-cx-muted truncate">{profile?.email}</div>
          <button
            onClick={handleLogout}
            className="w-full min-h-11 flex items-center gap-2 px-3 py-2 rounded-lg text-cx-muted hover:text-cx-text hover:bg-white/5 transition-colors"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-cx-border bg-cx-bg/95 px-4 backdrop-blur md:hidden">
          <div className="flex items-center gap-2 font-semibold">
            <img src="/censorx-logo.png" alt="" className="h-6 w-6 object-contain" />
            CensorX.ai
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-cx-muted hover:text-cx-text hover:bg-white/5"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={22} />
          </button>
        </header>
        <div className="p-4 sm:p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
