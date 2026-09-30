"use client";

import { useEffect, type RefObject } from "react";

/** Focus management, Escape, focus trap and background scroll lock for a WindSwordAI sheet. */
export function useSheetBehavior(dialogRef: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.body.dataset.sheetOpen = "true";
    const first = dialogRef.current?.querySelector<HTMLElement>("input, button.btn--primary, button");
    (first ?? dialogRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])")];
        if (!items.length) return;
        const firstEl = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === firstEl) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); firstEl.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      delete document.body.dataset.sheetOpen;
      previous?.focus?.();
    };
  }, [dialogRef, onClose]);
}
