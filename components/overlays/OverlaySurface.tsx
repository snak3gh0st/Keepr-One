"use client";

import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

type HiddenOutsideElement = {
  element: Element;
  ariaHidden: string | null;
  inert: boolean;
};

/** Hide every branch outside `root` while a modal surface is active. */
export function setOutsideContentInert(root: Element | null) {
  if (!root) return () => undefined;

  const changed: HiddenOutsideElement[] = [];
  let branch: Element | null = root;

  while (branch && branch !== document.body) {
    const parentElement: Element | null = branch.parentElement;
    if (!parentElement) break;

    for (const sibling of Array.from(parentElement.children)) {
      if (
        sibling === branch ||
        sibling.tagName === "SCRIPT" ||
        sibling.tagName === "STYLE" ||
        sibling.tagName === "LINK"
      ) {
        continue;
      }
      changed.push({
        element: sibling,
        ariaHidden: sibling.getAttribute("aria-hidden"),
        inert: sibling.hasAttribute("inert"),
      });
      sibling.setAttribute("aria-hidden", "true");
      sibling.setAttribute("inert", "");
    }

    branch = parentElement;
  }

  return () => {
    for (const { element, ariaHidden, inert } of changed) {
      if (ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", ariaHidden);
      if (!inert) element.removeAttribute("inert");
    }
  };
}

type OverlaySurfaceProps = {
  open: boolean;
  onClose: () => void;
  titleId: string;
  descriptionId?: string;
  variant?: "modal" | "drawer";
  children: ReactNode;
};

export function OverlaySurface({
  open,
  onClose,
  titleId,
  descriptionId,
  variant = "modal",
  children,
}: OverlaySurfaceProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const restoreOutsideContent = setOutsideContentInert(overlayRef.current);

    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      "[autofocus]:not([disabled]), button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
    );
    const focusFrame = window.requestAnimationFrame(() => {
      (focusable ?? panel)?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== "Tab" || !panel) return;
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === panel)
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreOutsideContent();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="crm-overlay"
      data-variant={variant}
      role="presentation"
    >
      <button
        type="button"
        className="crm-overlay-backdrop"
        aria-label="Fechar"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="crm-overlay-panel"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        {children}
      </div>
    </div>
  );
}
