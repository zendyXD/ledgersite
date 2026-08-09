"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import LedgerSiteLogo from "./LedgerSiteLogo";
import ThemeToggle from "./ThemeToggle";
import { LayoutDashboard, LogIn, UserPlus, User } from "lucide-react";

export default function PublicHeader() {
  const supabase = createClient();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      try {
        const { data } = await supabase.auth.getUser();
        setUser(data.user || null);
      } catch (err) {
        console.error("Error checking auth:", err);
      } finally {
        setLoading(false);
      }
    }
    checkAuth();
  }, [supabase]);

  return (
    <header className="w-full border-b border-[var(--border)] bg-[var(--card)] px-4 md:px-8 py-3.5 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
        {/* Branding */}
        <LedgerSiteLogo />

        {/* Right side controls */}
        <div className="flex items-center gap-2 md:gap-3">
          <ThemeToggle className="w-auto px-2.5 py-1.5 text-xs md:text-sm" />

          <div className="h-4 w-px bg-[var(--border)] mx-1" />

          {loading ? (
            <div className="h-8 w-20 bg-[var(--card-muted)] rounded-lg animate-pulse" />
          ) : user ? (
            <div className="flex items-center gap-2.5">
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-[var(--muted)] bg-[var(--card-muted)] px-2.5 py-1.5 rounded-md border border-[var(--border)] max-w-[180px] truncate">
                <User className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{user.email}</span>
              </span>
              <Link
                href="/dashboard"
                className="btn-theme-accent text-xs md:text-sm px-3.5 py-1.5 flex items-center gap-1.5 rounded-lg font-medium transition-colors"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Dashboard</span>
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card-muted)] border border-transparent transition-colors flex items-center gap-1.5"
              >
                <LogIn className="w-3.8 h-3.8" />
                <span>Login</span>
              </Link>
              <Link
                href="/signup"
                className="btn-theme-accent text-xs md:text-sm px-3.5 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
              >
                <UserPlus className="w-3.8 h-3.8" />
                <span>Sign Up</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
