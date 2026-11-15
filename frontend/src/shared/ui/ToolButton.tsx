import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Shared control for the workspace tools and analysis mode selector. */
export function ToolButton({ icon, children, ...button }: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string;
  children: ReactNode;
}) {
  return (
    <button {...button} type="button">
      <i className={`bi bi-${icon}`} aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}
