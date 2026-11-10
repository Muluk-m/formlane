export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#1c1915" />
        <circle cx="11" cy="13" r="3" fill="#8eb6ff" />
        <circle cx="20" cy="11" r="2.2" fill="#f0b429" />
        <circle cx="18.5" cy="20" r="3.2" fill="#ef7d57" />
        <circle cx="11" cy="21.5" r="1.6" fill="#7dcea0" />
      </svg>
      {compact ? "Atoms" : "Atoms Demo"}
    </span>
  );
}
