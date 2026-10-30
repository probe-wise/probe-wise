"use client";

import { useFormStatus } from "react-dom";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: string };

/** Submit button that disables itself while its form's action runs (prevents double submits). */
export function SubmitButton({ children, pendingLabel, disabled, className = "btn btn-primary", ...rest }: Props) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-disabled={pending || disabled} {...rest}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
