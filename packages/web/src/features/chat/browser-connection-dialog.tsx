import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { GoogleChromeLogoIcon } from "@phosphor-icons/react/dist/csr/GoogleChromeLogo";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { Button } from "../../components/ui/button";
import { CloseButton } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { TravelAgentLogo } from "../../components/ui/travel-agent-logo";
import { desktopBrowserBridge } from "../../lib/desktop-bridge";
import { S } from "../../lib/strings";

/** Main verifies the connection; this confirmation never starts or changes a task. */
export function BrowserConnectionDialog() {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const T = S.chat.browserPane;

  useEffect(() => {
    let frame = 0;
    const unsubscribe = desktopBrowserBridge()?.onExtensionReady?.(() => {
      cancelAnimationFrame(frame);
      // Let the browser menu finish closing and restoring focus before opening another layer.
      frame = requestAnimationFrame(() => {
        if (!contentRef.current) {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        setOpen(true);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const content = contentRef.current;
    const buttons = content?.querySelectorAll<HTMLButtonElement>("button");
    const first = buttons?.[0];
    const last = buttons?.[buttons.length - 1];
    last?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !content?.contains(event.target)) last?.focus();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focusin", onFocus);
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, [open]);

  return (
    <Modal
      open={open}
      title={T.connectionReadyTitle}
      onClose={close}
      headerless
      widthClass="sm:max-w-[420px]"
      contentClassName="!p-6 sm:!p-8"
    >
      <div ref={contentRef} className="relative">
        <CloseButton onClose={close} className="absolute -right-2 -top-2" />
        <div className="mb-6 flex items-center gap-3">
          <div className="relative rounded-2xl bg-blue-50 p-2.5 dark:bg-blue-950/40">
            <TravelAgentLogo className="h-10 w-10" />
            <span className="absolute -bottom-1 -right-1 rounded-full border-[3px] border-white bg-emerald-600 p-1 text-white dark:border-gray-900">
              <CheckIcon size={12} weight="bold" aria-hidden />
            </span>
          </div>
          <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">
            Travel Browser
          </span>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          {T.connectionReadyTitle}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {T.connectionReadyBody}
        </p>
        <div className="mt-6 flex gap-3 rounded-xl border border-gray-200/70 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/40">
          <GoogleChromeLogoIcon
            size={20}
            className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400"
            aria-hidden
          />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
              {T.connectionExistingTabTitle}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {T.connectionExistingTabHint}
            </p>
          </div>
        </div>
        <Button variant="primary" onClick={close} className="mt-6 min-h-11 w-full !rounded-xl">
          {T.connectionContinue}
          <ArrowRightIcon size={16} className="ml-1" aria-hidden />
        </Button>
      </div>
    </Modal>
  );
}
