"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

type BackButtonProps = {
  fallbackHref?: string;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export default function BackButton({
  fallbackHref = "/signals",
  children = "← Back",
  className,
  ariaLabel,
}: BackButtonProps) {
  const router = useRouter();

  function handleBack() {
    if (window.history.length <= 1) {
      router.push(fallbackHref);
      return;
    }

    router.back();

    window.setTimeout(() => {
      if (window.location.pathname === fallbackHref) return;
      if (window.history.length <= 1) {
        router.push(fallbackHref);
      }
    }, 250);
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      className={className}
      aria-label={ariaLabel ?? "Go back"}
    >
      {children}
    </button>
  );
}
