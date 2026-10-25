import { useEffect, useRef, type ReactNode } from "react";
const icons: Record<string, ReactNode> = {
  pen: (
    <>
      <path d="m15 4 5 5M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z" />
      <path d="M4 20h16" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-4-5" />
    </>
  ),
  prompt: (
    <>
      <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4M9 3h6v4H9zM7 11h10M7 15h7" />
    </>
  ),
  history: (
    <>
      <path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  external: (
    <path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
  ),
  check: <path d="m5 12 4 4L19 6" />,
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6m0-6-6 6" />
    </>
  ),
  warning: <path d="m12 3 10 18H2L12 3ZM12 9v4m0 4h.01" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  logout: <path d="M9 4H4v16h5m5-13 5 5-5 5m-5-5h10" />,
  cloud: (
    <path d="M7 18H6a4 4 0 0 1-.6-8A7 7 0 0 1 19 8a5 5 0 0 1 0 10h-2M12 21V12m-3 3 3-3 3 3" />
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  trello: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 7v10M16 7v6" />
    </>
  ),
  refresh: (
    <path d="M20 5v6h-6M4 19v-6h6M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" />
  ),
  moon: <path d="M20 14A8 8 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z" />,
  trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />,
};
export function Icon({
  name,
  size = 19,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {icons[name] ?? icons.pen}
    </svg>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Icon name="pen" size={22} />
      </span>
      <span>
        auto<span className="brand-light">write</span>
        <small>CONTENT STUDIO</small>
      </span>
    </div>
  );
}
export function Notice({
  kind = "info",
  children,
}: {
  kind?: "info" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "danger" ? "alert" : "status"}
    >
      <Icon
        name={
          kind === "danger"
            ? "error"
            : kind === "warning"
              ? "warning"
              : kind === "success"
                ? "check"
                : "cloud"
        }
      />
      <div>{children}</div>
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Đóng" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
