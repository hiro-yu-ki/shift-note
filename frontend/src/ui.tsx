import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState, useContext, createContext, type ReactNode } from "react";
import { hm, mins } from "./types";
export const TimeUnit = createContext(30);
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal" aria-describedby={undefined}>
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close aria-label="閉じる" className="icon">
              <X size={20} />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Time({
  value,
  onChange,
  label,
  disabled = false,
  step,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  disabled?: boolean;
  step?: number;
}) {
  const defaultStep = useContext(TimeUnit);
  const unit = step || defaultStep;
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) =>
        onChange(
          mins(
            e.target.value.includes(":")
              ? e.target.value
              : hm(Number(e.target.value)),
          ),
        )
      }
    >
      {Array.from({ length: 1440 / unit + 1 }, (_, i) => i * unit).map((n) => (
        <option key={n} value={n}>
          {hm(n)}
        </option>
      ))}
    </select>
  );
}
export function Num({
  label,
  value,
  onChange,
  min = 0,
  max = 168,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        required
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function AsyncButton({
  action,
  children,
  className = "primary",
  disabled = false,
}: {
  action: () => Promise<unknown>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await action();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "処理中…" : children}
    </button>
  );
}
