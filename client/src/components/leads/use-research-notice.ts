import { useEffect, useState } from "react";

type TerminalStatus = "completed" | "budget_exhausted";
const acknowledged = new Set<string>();
let storageWarningShown = false;

function wasAcknowledged(key: string) {
  if (acknowledged.has(key)) return true;
  try {
    return window.localStorage.getItem(key) === "acknowledged";
  } catch {
    warnStorage();
    return false;
  }
}

function warnStorage() {
  if (storageWarningShown) return;
  storageWarningShown = true;
  console.warn("Research notification storage is unavailable. Dismissals are remembered for this page session only.");
}

export function useResearchNotice(
  batchId: string,
  runIdentity: string | undefined,
  status: string | undefined,
  unavailable: boolean,
) {
  const terminal = status === "completed" || status === "budget_exhausted";
  const key = terminal && !unavailable
    ? `full-research-notice:${encodeURIComponent(batchId)}:${encodeURIComponent(runIdentity ?? "legacy")}:${status}`
    : null;
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  useEffect(() => {
    setNoticeKey(key && !wasAcknowledged(key) ? key : null);
  }, [key]);

  const dismiss = () => {
    if (key && noticeKey === key) {
      acknowledged.add(key);
      try {
        window.localStorage.setItem(key, "acknowledged");
      } catch {
        warnStorage();
      }
    }
    setNoticeKey(null);
  };

  return {
    open: Boolean(key && noticeKey === key),
    status: (terminal ? status : "completed") as TerminalStatus,
    dismiss,
  };
}
