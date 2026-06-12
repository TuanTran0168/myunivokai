import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

type StatusMessageProps = {
  tone?: "error" | "success" | "loading";
  children: ReactNode;
};

export function StatusMessage({ tone = "success", children }: StatusMessageProps) {
  const styles = {
    error: "border-error/30 bg-error-container/25 text-on-surface",
    success: "border-secondary/25 bg-secondary/10 text-on-surface",
    loading: "border-primary/25 bg-primary/10 text-on-surface"
  };
  const Icon = tone === "error" ? AlertCircle : tone === "loading" ? Loader2 : CheckCircle2;

  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${styles[tone]}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone === "loading" ? "animate-spin" : ""}`} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
