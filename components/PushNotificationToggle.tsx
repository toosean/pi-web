"use client";

import { useI18n } from "@/hooks/useI18n";
import { usePushNotifications } from "@/hooks/usePushNotifications";

/**
 * Web Push notification toggle, shown at the bottom of the session sidebar.
 *
 * Lets the user opt in/out of system notifications when an agent task
 * finishes or starts waiting for input. Enabling must be triggered by a
 * user gesture (Notification permission rules), so this is a real button
 * rather than an auto-subscribing effect.
 *
 * State lines up with the Push API lifecycle:
 *   - unsupported browser  -> disabled button, "unsupported" status
 *   - permission denied    -> clickable again (re-requests), "denied" status
 *   - subscribed           -> "on" status, click disables
 *   - otherwise            -> "off" status, click enables
 */
export function PushNotificationTopButton({
  buttonRef,
  active,
  onClick,
  buttonSize = 36,
}: {
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  active: boolean;
  onClick: () => void;
  buttonSize?: number;
}) {
  const { t } = useI18n();
  const { supported, permission, subscribed } = usePushNotifications();

  const enabled = subscribed;

  let title: string;
  if (!supported) {
    title = t("push.unsupported");
  } else if (enabled) {
    title = t("push.disableTitle");
  } else if (permission === "denied") {
    title = t("push.denied");
  } else {
    title = t("push.enableTitle");
  }

  const color = enabled
    ? "var(--accent)"
    : active
    ? "var(--text)"
    : "var(--text-muted)";

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-haspopup="menu"
      aria-expanded={active}
      aria-pressed={active || enabled}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: buttonSize,
        height: buttonSize,
        padding: 0,
        background: active ? "var(--bg-selected)" : "none",
        border: "none",
        borderRight: "1px solid var(--border)",
        color,
        cursor: "pointer",
        flexShrink: 0,
        opacity: !supported ? 0.45 : 1,
        transition: "color 0.12s, background 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = enabled ? "var(--accent)" : "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = color;
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    </button>
  );
}

export function PushNotificationDropdownMenu({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { supported, subscribed, busy, enable, disable } = usePushNotifications();

  const enabled = subscribed;
  const disabled = !supported || busy;

  const items = [
    { id: "enable", label: t("push.enable"), active: enabled, action: () => void enable() },
    { id: "disable", label: t("push.disable"), active: !enabled, action: () => void disable() },
  ];

  return (
    <>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          disabled={disabled}
          onClick={() => {
            item.action();
            onClose();
          }}
          role="menuitemradio"
          aria-checked={item.active}
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            height: 34,
            padding: "0 10px",
            border: "none",
            borderRadius: 4,
            background: item.active ? "var(--bg-selected)" : "transparent",
            color: "var(--text)",
            cursor: disabled ? "default" : "pointer",
            textAlign: "left",
            fontSize: 12,
            opacity: disabled ? 0.5 : 1,
            transition: "background 0.1s",
          }}
          onMouseEnter={(e) => {
            if (!item.active && !disabled) e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (!item.active && !disabled) e.currentTarget.style.background = "transparent";
          }}
        >
          <span>{item.label}</span>
        </button>
      ))}
    </>
  );
}

export function PushNotificationToggle({ iconOnly = false, buttonSize }: { iconOnly?: boolean; buttonSize?: number }) {
  const { t } = useI18n();
  const { supported, permission, subscribed, busy, enable, disable } = usePushNotifications();

  const enabled = subscribed;

  let status: string;
  let title: string;
  if (!supported) {
    status = t("push.unsupported");
    title = t("push.unsupported");
  } else if (enabled) {
    status = t("push.enabled");
    title = t("push.disableTitle");
  } else if (permission === "denied") {
    status = t("push.denied");
    title = t("push.denied");
  } else {
    status = t("push.disabled");
    title = t("push.enableTitle");
  }

  const label = enabled ? t("push.disable") : t("push.enable");
  const disabled = !supported || busy;

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={() => {
          if (enabled) void disable();
          else void enable();
        }}
        disabled={disabled}
        title={title}
        aria-label={label}
        aria-pressed={enabled}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: buttonSize ?? 36,
          height: buttonSize ?? 36,
          padding: 0,
          background: "none",
          border: "none",
          borderRight: "1px solid var(--border)",
          color: enabled ? "var(--accent)" : "var(--text-muted)",
          cursor: disabled ? "default" : "pointer",
          flexShrink: 0,
          opacity: !supported ? 0.45 : 1,
          transition: "color 0.12s",
        }}
        onMouseEnter={(e) => {
          if (!disabled) {
            e.currentTarget.style.color = enabled ? "var(--accent)" : "var(--text)";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = enabled ? "var(--accent)" : "var(--text-muted)";
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (enabled) void disable();
        else void enable();
      }}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={enabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 32,
        padding: "0 10px",
        background: "none",
        border: "none",
        borderRadius: 9,
        color: enabled ? "var(--accent)" : "var(--text-muted)",
        cursor: disabled ? "default" : "pointer",
        fontSize: 12,
        opacity: !supported ? 0.45 : 1,
        transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = enabled ? "var(--accent)" : "var(--text)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "none";
        e.currentTarget.style.color = enabled ? "var(--accent)" : "var(--text-muted)";
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
        aria-hidden="true"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>{label}</span>
      <span
        style={{
          marginLeft: "auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 11,
          color: enabled ? "var(--text-muted)" : "var(--text-dim)",
        }}
      >
        {status}
      </span>
    </button>
  );
}
