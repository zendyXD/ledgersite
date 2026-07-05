"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, UploadCloud, Inbox, BookOpen, CalendarClock, BarChart3 } from "lucide-react";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Upload", href: "/uploads", icon: UploadCloud },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Ledger", href: "/ledger", icon: BookOpen },
  { label: "Monthly Close", href: "/close", icon: CalendarClock },
  { label: "Reports", href: "/reports", icon: BarChart3 },
];

const hideOnRoutes = ["/login", "/signup"];

export default function Sidebar() {
  const pathname = usePathname();

  if (hideOnRoutes.includes(pathname)) return null;

  return (
    <aside className="hidden md:flex flex-col w-52 h-full bg-[var(--card)] border-r border-[var(--border)] px-3 py-6 shrink-0 overflow-y-auto">
      {/* Branding */}
      <div className="mb-8 px-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">LedgerSite</p>
        <p className="text-[11px] text-[var(--muted)] mt-0.5">Construction bookkeeping</p>
      </div>

      {/* Nav links */}
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href.split("#")[0]) && item.href.split("#")[0] !== "/";
          return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-300 ${
                  isActive
                    ? "bg-[var(--card-muted)] text-[var(--foreground)] font-semibold border-l-2 border-[var(--primary)] shadow-[inset_6px_0_12px_-6px_rgba(20,184,166,0.25)] rounded-l-none"
                    : "text-[var(--muted)] font-medium hover:bg-[var(--card-muted)] hover:text-[var(--foreground)] border-l-2 border-transparent rounded-l-none"
                }`}
              >
                <span className={`text-base transition-colors ${isActive ? "text-[var(--primary)]" : "text-[var(--muted)] group-hover:text-[var(--foreground)]"}`}>
                  <item.icon className="w-5 h-5" strokeWidth={2} />
                </span>
                {item.label}
              </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="mt-auto px-2">
        <p className="text-[10px] text-[var(--muted)] opacity-70">MVP v1</p>
      </div>
    </aside>
  );
}