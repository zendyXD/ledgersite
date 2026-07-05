"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check initial theme on mount
    const isDarkMode = document.documentElement.classList.contains("dark");
    setIsDark(isDarkMode);
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
  };

  return (
    <button
      onClick={toggleTheme}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:bg-[var(--card-muted)] hover:text-[var(--foreground)] transition-all duration-300 w-full"
    >
      <span className="text-[var(--muted)] group-hover:text-[var(--foreground)]">
        {isDark ? (
          <Sun className="w-5 h-5" strokeWidth={2} />
        ) : (
          <Moon className="w-5 h-5" strokeWidth={2} />
        )}
      </span>
      {isDark ? "Light Mode" : "Dark Mode"}
    </button>
  );
}
