"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: "⊞" },
  { label: "Upload", href: "/uploads", icon: "↑" },
  { label: "Inbox", href: "/inbox", icon: "▤" },
  { label: "Ledger", href: "/ledger", icon: "₹" },
  { label: "Monthly Close", href: "/close", icon: "⏱" },
  { label: "Reports", href: "/reports", icon: "↗" },
];

const hideOnRoutes = ["/login", "/signup"];

export default function Sidebar() {
  const pathname = usePathname();

  if (hideOnRoutes.includes(pathname)) return null;

  return (
    <aside className="hidden md:flex flex-col w-52 h-full bg-white border-r border-slate-200 px-3 py-6 shrink-0 overflow-y-auto">
      {/* Branding */}
      <div className="mb-8 px-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">LedgerSite</p>
        <p className="text-[11px] text-slate-400 mt-0.5">Construction bookkeeping</p>
      </div>

      {/* Nav links */}
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href.split("#")[0]) && item.href.split("#")[0] !== "/";
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="mt-auto px-2">
        <p className="text-[10px] text-slate-300">MVP v1</p>
      </div>
    </aside>
  );
}