"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle({ className = "w-full" }: { className?: string }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check initial theme on mount
    const isDarkMode = document.documentElement.classList.contains("dark");
    setIsDark(isDarkMode);

    const handleThemeChange = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };

    window.addEventListener("theme-change", handleThemeChange);
    return () => window.removeEventListener("theme-change", handleThemeChange);
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    
    if (nextDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }

    window.dispatchEvent(new Event("theme-change"));
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:bg-[var(--card-muted)] hover:text-[var(--foreground)] transition-all duration-200 ${className}`}
      aria-label="Toggle theme"
    >
      <span className="text-[var(--muted)] group-hover:text-[var(--foreground)] flex items-center justify-center">
        {isDark ? (
          <Sun className="w-4 h-4 text-amber-400" strokeWidth={2} />
        ) : (
          <Moon className="w-4 h-4 text-slate-600 dark:text-slate-400" strokeWidth={2} />
        )}
      </span>
      <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
    </button>
  );
}

