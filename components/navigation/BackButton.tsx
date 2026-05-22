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
  fallbackHref = "/",
  children = "← Back",
  className,
  ariaLabel,
}: BackButtonProps) {
  const router = useRouter();
  void fallbackHref;

  function handleBack() {
    router.back();
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
