import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Globe, Mail, Menu, X } from "lucide-react";

const navItems = [
  { label: "Home", to: "/" },
  { label: "Features", to: "/features" },
  { label: "Contact", to: "/contact" },
];

export default function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-cx-border bg-cx-bg/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold text-lg">
            <img src="/censorx-logo.png" alt="CensorX" className="h-[22px] w-[22px] object-contain" />
            CensorX.ai
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `hover:text-cx-accent transition-colors ${isActive ? "text-cx-accent" : "text-cx-muted"}`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <Link
              to="/login"
              className="min-h-11 inline-flex items-center px-4 py-2 rounded-lg border border-cx-accent/40 text-cx-accent hover:bg-cx-accent/10 transition-colors"
            >
              Login
            </Link>
          </nav>

          <button
            className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/5"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-cx-border px-4 py-3 flex flex-col gap-3 text-sm">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className="min-h-11 flex items-center text-cx-muted" onClick={() => setMenuOpen(false)}>
                {item.label}
              </NavLink>
            ))}
            <Link to="/login" className="min-h-11 flex items-center text-cx-accent" onClick={() => setMenuOpen(false)}>
              Login
            </Link>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-cx-border py-8 mt-16">
        <div className="max-w-6xl mx-auto px-4 grid gap-5 md:grid-cols-[1fr_auto_1fr] md:items-center text-sm text-cx-muted">
          <div>
            <div className="flex items-center gap-2 font-medium text-cx-text mb-2">
              <img src="/censorx-logo.png" alt="CensorX" className="h-[18px] w-[18px] object-contain" />
              CensorX.ai
            </div>
            <p>Privacy-first safety for schools and families.</p>
          </div>
          <div className="flex flex-wrap gap-4 md:gap-6">
            <Link to="/" className="hover:text-cx-text">Home</Link>
            <Link to="/features" className="hover:text-cx-text">Features</Link>
            <Link to="/contact" className="hover:text-cx-text">Contact</Link>
            <span>Privacy Policy</span>
            <span>Terms</span>
          </div>
          <div className="space-y-2 md:text-right">
            <a href="mailto:contact@censorx.in" className="flex md:justify-end items-center gap-2 hover:text-cx-text">
              <Mail size={16} /> contact@censorx.in
            </a>
            <a href="https://censorx.in" className="flex md:justify-end items-center gap-2 hover:text-cx-text">
              <Globe size={16} /> censorx.in
            </a>
            <div>&copy; {new Date().getFullYear()} CensorX.ai. All rights reserved.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
