"use client";

import * as React from "react";
import { useActionState, useEffect } from "react";

export type SaveBusinessKnowledgeState =
  | {
      status: "error";
      fieldErrors: Record<string, string>;
      firstErrorField: string;
    }
  | undefined;

type SaveAction = (
  prev: SaveBusinessKnowledgeState,
  fd: FormData,
) => Promise<SaveBusinessKnowledgeState>;

const FieldErrorsCtx = React.createContext<Record<string, string>>({});

export function useFieldError(name: string): string | undefined {
  return React.useContext(FieldErrorsCtx)[name];
}

export function FieldErrorMessage({ name }: { name: string }) {
  const err = useFieldError(name);
  if (!err) return null;
  return (
    <p
      id={`${name}-error`}
      role="alert"
      className="text-xs text-destructive"
    >
      {err}
    </p>
  );
}

const ERROR_CLASSES = ["border-destructive", "ring-2", "ring-destructive/30"];

export function BusinessKnowledgeFormShell({
  action,
  className,
  children,
}: {
  action: SaveAction;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState<
    SaveBusinessKnowledgeState,
    FormData
  >(action, undefined);
  const fieldErrors = state?.status === "error" ? state.fieldErrors : {};

  useEffect(() => {
    if (!state || state.status !== "error") return;

    const highlighted: HTMLElement[] = [];
    for (const name of Object.keys(state.fieldErrors)) {
      const el = document.getElementById(name);
      if (el instanceof HTMLElement) {
        el.setAttribute("aria-invalid", "true");
        el.setAttribute("aria-describedby", `${name}-error`);
        el.classList.add(...ERROR_CLASSES);
        highlighted.push(el);
      }
    }

    function clearOnInput(this: HTMLElement) {
      this.removeAttribute("aria-invalid");
      this.removeAttribute("aria-describedby");
      this.classList.remove(...ERROR_CLASSES);
    }
    for (const el of highlighted) {
      el.addEventListener("input", clearOnInput, { once: true });
    }

    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    const firstId = state.firstErrorField;
    if (firstId) {
      const first = document.getElementById(firstId);
      if (first instanceof HTMLElement) {
        first.scrollIntoView({ behavior: "smooth", block: "center" });
        focusTimer = setTimeout(
          () => first.focus({ preventScroll: true }),
          350,
        );
      }
    }

    return () => {
      if (focusTimer) clearTimeout(focusTimer);
      for (const el of highlighted) {
        el.removeEventListener("input", clearOnInput);
      }
    };
  }, [state]);

  return (
    <FieldErrorsCtx.Provider value={fieldErrors}>
      {state?.status === "error" ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          לא ניתן לשמור — בדוק את השדות המסומנים.
        </div>
      ) : null}
      <form id="manual" action={formAction} className={className}>
        {children}
      </form>
    </FieldErrorsCtx.Provider>
  );
}
