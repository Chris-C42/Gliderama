import type { ComponentChildren } from 'preact';

export function Modal(props: { children: ComponentChildren; onClose?: () => void; class?: string; plain?: boolean }) {
  return (
    <div
      class="backdrop"
      data-ui
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) props.onClose?.();
      }}
    >
      <div class={`modal card ${props.plain ? 'card--plain' : ''} ${props.class ?? ''}`}>{props.children}</div>
    </div>
  );
}
