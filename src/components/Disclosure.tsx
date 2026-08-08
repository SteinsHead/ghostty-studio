import { useId, useState, type ReactNode } from "react";

interface DisclosureProps {
  className: string;
  summary: ReactNode;
  summaryLabel?: string;
  children: ReactNode;
  bodyClassName?: string;
  defaultOpen?: boolean;
}

export function Disclosure({
  className,
  summary,
  summaryLabel,
  children,
  bodyClassName,
  defaultOpen = false,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={className} data-expanded={open ? "true" : "false"}>
      <button
        type="button"
        className="disclosure-summary"
        aria-label={summaryLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {summary}
      </button>
      <div
        id={panelId}
        className="disclosure-viewport"
        aria-hidden={!open}
      >
        <div className="disclosure-clip">
          <div className={bodyClassName}>{children}</div>
        </div>
      </div>
    </div>
  );
}
