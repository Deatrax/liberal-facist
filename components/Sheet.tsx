"use client";

import { useEffect, type ReactNode } from "react";

/** A flat modal sheet: bottom sheet on phones, centred on larger screens. Esc / backdrop / Close dismiss it. */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="sheet-up max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[10px] border-[1.5px] border-ink bg-paper p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-[10px]"
      >
        <div className="mb-3 flex justify-end">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
