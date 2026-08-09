import Link from "next/link";

export default function LedgerSiteLogo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 group ${className}`}>
      <div className="w-8 h-8 rounded-lg bg-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)] shadow-sm transition-transform duration-200 group-hover:scale-[1.03]">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Construction beam / ledger structure */}
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
          <path d="M8 6v12" />
          <path d="M16 6v12" />
        </svg>
      </div>
      <div className="flex flex-col">
        <span className="font-bold text-base tracking-tight text-[var(--foreground)] leading-none group-hover:text-[var(--primary)] transition-colors">
          LedgerSite
        </span>
        <span className="text-[10px] uppercase font-semibold tracking-wider text-[var(--muted)] leading-tight mt-0.5">
          Construction Bookkeeping
        </span>
      </div>
    </Link>
  );
}
