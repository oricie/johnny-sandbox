import type { Severity } from "../api/types";

// Neutral by default. Pass `severity` to colour it with the --color-sev-* tokens;
// the label text (the severity word) is always rendered, never colour alone.
export function Badge({ children, severity }: { children: string; severity?: Severity }) {
  const className = severity ? `badge badge--sev badge--sev-${severity}` : "badge";
  return <span className={className}>{children}</span>;
}
