import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";

/**
 * Themed drop-in for <select>. It reads the same <option>/<optgroup> children and
 * calls onChange with an event-like object exposing target.value, so existing
 * handlers keep working. A dropdown on larger screens, a bottom sheet on phones.
 */

interface Opt {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function collect(children: ReactNode, group: string | undefined, out: Opt[]) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as {
      value?: string | number;
      label?: string;
      disabled?: boolean;
      children?: ReactNode;
    };
    if (child.type === "option") {
      const label = textOf(props.children);
      out.push({
        value: props.value === undefined ? label : String(props.value),
        label,
        group,
        disabled: props.disabled,
      });
    } else if (child.type === "optgroup") {
      collect(props.children, props.label, out);
    } else if (child.type === Fragment) {
      collect(props.children, group, out);
    }
  });
}

interface SelectProps {
  value: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  className?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export default function Select({
  value,
  onChange,
  children,
  className = "",
  id,
  disabled,
  "aria-label": ariaLabel,
}: SelectProps) {
  const options: Opt[] = [];
  collect(children, undefined, options);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function openList() {
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function choose(option: Opt | undefined) {
    if (!option || option.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (option.value !== value) {
      onChange?.({
        target: { value: option.value },
        currentTarget: { value: option.value },
      } as unknown as ChangeEvent<HTMLSelectElement>);
    }
  }

  function move(step: number) {
    if (options.length === 0) return;
    let next = activeIndex;
    for (let count = 0; count < options.length; count++) {
      next = (next + step + options.length) % options.length;
      if (!options[next].disabled) break;
    }
    setActive(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openList();
      else move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (open && event.key === "Home") {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (open && event.key === "End") {
      event.preventDefault();
      setActive(Math.max(options.length - 1, 0));
      return;
    }
    if (open && (event.key === "Enter" || event.key === " ") && event.target === triggerRef.current) {
      event.preventDefault();
      choose(options[activeIndex]);
    }
  }

  return (
    <div
      className="relative min-w-0"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className="min-w-0 break-words">{selected?.label ?? ""}</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-cx-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <div aria-hidden="true" className="fixed inset-0 z-[65] bg-cx-night/50 sm:hidden" onClick={() => setOpen(false)} />
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            onMouseDown={(event) => event.preventDefault()}
            className="fixed inset-x-0 bottom-0 z-[70] max-h-[70vh] animate-pop overflow-y-auto rounded-t-3xl border border-cx-border bg-white p-2 pb-6 shadow-[0_-16px_48px_rgba(4,21,20,0.25)] motion-reduce:animate-none sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1.5 sm:max-h-64 sm:w-full sm:min-w-[12rem] sm:rounded-xl sm:p-1 sm:pb-1 sm:shadow-[0_12px_32px_rgba(11,18,32,0.14)]"
          >
            <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-cx-field sm:hidden" />
            {options.map((option, index) => {
              const isSelected = index === selectedIndex;
              const isActive = index === activeIndex;
              const showGroup = option.group && option.group !== options[index - 1]?.group;
              return (
                <Fragment key={`${index}-${option.value}`}>
                  {showGroup && (
                    <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-cx-muted">
                      {option.group}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-active={isActive}
                    disabled={option.disabled}
                    tabIndex={-1}
                    onClick={() => choose(option)}
                    onMouseEnter={() => setActive(index)}
                    className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      isActive ? "bg-cx-tint text-cx-accent" : "text-cx-text"
                    } ${isSelected ? "font-semibold" : ""}`}
                  >
                    <span className="min-w-0 break-words">{option.label}</span>
                    {isSelected && <Check size={16} aria-hidden="true" className="shrink-0 text-cx-accent" />}
                  </button>
                </Fragment>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
