import type { Severity } from "../api/types";

// Default badge for status labels. Pass `severity` for the severity variant:
// the severity colour is a dot and border, the word stays in the text colour.
export function Badge({ children, severity }: { children: string; severity?: Severity }) {
  const className = severity ? `badge badge-sev badge-sev-${severity}` : "badge";
  return <span className={className}>{children}</span>;
}
