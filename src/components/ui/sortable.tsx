"use client";

import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
  DragCancelEvent,
  DragEndEvent,
  DragStartEvent,
  DropAnimation,
  Modifiers,
  UniqueIdentifier,
} from "@dnd-kit/core";
import {
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  defaultAnimateLayoutChanges,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";

const subscribeToNothing = () => () => {};
const getMountedSnapshot = () => true;
const getServerMountedSnapshot = () => false;

const subscribeToReducedMotion = (onStoreChange: () => void) => {
  if (typeof window === "undefined") return () => {};
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
};
const getReducedMotionSnapshot = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const getServerReducedMotionSnapshot = () => false;

const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 10 } };
const TOUCH_SENSOR_OPTIONS = { activationConstraint: { delay: 250, tolerance: 5 } };
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };
const MEASURING_CONFIG = { droppable: { strategy: MeasuringStrategy.Always } };
const DROP_ANIMATION_CONFIG: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.4" } },
  }),
};
const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true });

interface SortableContextValue {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  isDragging: boolean;
  disabled: boolean | undefined;
}

const SortableItemContext = createContext<SortableContextValue>({
  attributes: {
    role: "button",
    tabIndex: 0,
    "aria-disabled": false,
    "aria-pressed": undefined,
    "aria-roledescription": "sortable",
    "aria-describedby": "",
  },
  listeners: undefined,
  setActivatorNodeRef: () => {},
  isDragging: false,
  disabled: false,
});

interface SortableRootContextValue {
  activeId: UniqueIdentifier | null;
  modifiers: Modifiers | undefined;
  reducedMotion: boolean;
}

const SortableRootContext = createContext<SortableRootContextValue>({
  activeId: null,
  modifiers: undefined,
  reducedMotion: false,
});

export interface SortableCommitMeta<T> {
  event: DragEndEvent;
  activeIndex: number;
  overIndex: number;
  previousValue: T[];
}

export interface SortableRootProps<T> extends Omit<
  useRender.ComponentProps<"div">,
  "children" | "onDragStart" | "onDragEnd"
> {
  value: T[];
  onValueChange: (value: T[]) => void;
  getItemValue: (item: T) => string;
  children: React.ReactNode;
  onMove?: (event: { event: DragEndEvent; activeIndex: number; overIndex: number }) => void;
  onValueCommit?: (value: T[], meta: SortableCommitMeta<T>) => void;
  strategy?: "horizontal" | "vertical" | "grid";
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragCancel?: (event: DragCancelEvent) => void;
  accessibility?: React.ComponentProps<typeof DndContext>["accessibility"];
  modifiers?: Modifiers;
  renderOverlay?: (value: UniqueIdentifier) => React.ReactNode;
}

const STRATEGY_MAP = {
  horizontal: rectSortingStrategy,
  grid: rectSortingStrategy,
  vertical: verticalListSortingStrategy,
} as const;

function Sortable<T>({
  value,
  onValueChange,
  getItemValue,
  children,
  className,
  render,
  onMove,
  onValueCommit,
  strategy = "vertical",
  onDragStart,
  onDragEnd,
  onDragCancel,
  accessibility,
  modifiers,
  renderOverlay,
  ...props
}: SortableRootProps<T>) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getServerReducedMotionSnapshot,
  );
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  const itemIds = useMemo(() => value.map(getItemValue), [getItemValue, value]);
  const rootContext = useMemo(
    () => ({ activeId, modifiers, reducedMotion }),
    [activeId, modifiers, reducedMotion],
  );
  const accessibilityProps = useMemo(() => {
    if (!mounted) return accessibility;
    return { ...accessibility, container: accessibility?.container ?? document.body };
  }, [accessibility, mounted]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveId(event.active.id);
      onDragStart?.(event);
    },
    [onDragStart],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      onDragEnd?.(event);
      if (!over) return;

      const activeIndex = itemIds.indexOf(String(active.id));
      const overIndex = itemIds.indexOf(String(over.id));
      if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return;

      const nextValue = arrayMove(value, activeIndex, overIndex);
      if (onMove) {
        onMove({ event, activeIndex, overIndex });
        return;
      }
      onValueChange(nextValue);
      onValueCommit?.(nextValue, {
        event,
        activeIndex,
        overIndex,
        previousValue: value,
      });
    },
    [itemIds, onDragEnd, onMove, onValueChange, onValueCommit, value],
  );

  const handleDragCancel = useCallback(
    (event: DragCancelEvent) => {
      setActiveId(null);
      onDragCancel?.(event);
    },
    [onDragCancel],
  );

  const defaultProps = {
    "data-slot": "sortable",
    "data-dragging": activeId !== null,
    className: cn(activeId !== null && "cursor-grabbing!", className),
    children,
  };

  return (
    <SortableRootContext.Provider value={rootContext}>
      <DndContext
        sensors={sensors}
        modifiers={modifiers}
        accessibility={accessibilityProps}
        measuring={{ droppable: MEASURING_CONFIG.droppable }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={itemIds} strategy={STRATEGY_MAP[strategy]}>
          {useRender({
            defaultTagName: "div",
            render,
            props: mergeProps<"div">(defaultProps, props),
          })}
        </SortableContext>
        {mounted && renderOverlay && activeId !== null
          ? createPortal(
              <DragOverlay
                dropAnimation={reducedMotion ? null : DROP_ANIMATION_CONFIG}
                modifiers={modifiers}
                className="z-50 cursor-grabbing"
              >
                {renderOverlay(activeId)}
              </DragOverlay>,
              document.body,
            )
          : null}
      </DndContext>
    </SortableRootContext.Provider>
  );
}

export interface SortableItemProps extends useRender.ComponentProps<"div"> {
  value: string;
  disabled?: boolean;
}

function SortableItem({ value, className, render, disabled, ...props }: SortableItemProps) {
  const { reducedMotion } = useContext(SortableRootContext);
  const {
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging,
  } = useSortable({
    id: value,
    disabled,
    animateLayoutChanges,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
  };

  const defaultProps = {
    "data-slot": "sortable-item",
    "data-value": value,
    "data-dragging": isDragging,
    "data-disabled": disabled,
    ref: setNodeRef,
    style,
    className: cn(
      "transition-[transform,opacity] duration-150 motion-reduce:transition-none",
      isDragging && "relative z-10 opacity-50",
      className,
    ),
    children: props.children,
  };
  const contextValue = useMemo(
    () => ({
      attributes,
      listeners,
      setActivatorNodeRef,
      isDragging,
      disabled,
    }),
    [attributes, listeners, setActivatorNodeRef, isDragging, disabled],
  );

  return (
    <SortableItemContext.Provider value={contextValue}>
      {useRender({
        defaultTagName: "div",
        render,
        props: mergeProps<"div">(defaultProps, props),
      })}
    </SortableItemContext.Provider>
  );
}

export interface SortableItemHandleProps extends useRender.ComponentProps<"button"> {
  cursor?: boolean;
}

function SortableItemHandle({
  className,
  render,
  cursor = true,
  disabled: externalDisabled,
  ...props
}: SortableItemHandleProps) {
  const { attributes, listeners, setActivatorNodeRef, isDragging, disabled } =
    useContext(SortableItemContext);
  const defaultProps = {
    "data-slot": "sortable-item-handle",
    "data-dragging": isDragging,
    "data-disabled": disabled,
    ref: setActivatorNodeRef,
    ...attributes,
    ...listeners,
    disabled: externalDisabled || disabled,
    className: cn(cursor && (isDragging ? "cursor-grabbing!" : "cursor-grab!"), className),
    children: props.children,
  };

  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(defaultProps, props),
  });
}

export interface SortableOverlayProps extends Omit<
  React.ComponentProps<typeof DragOverlay>,
  "children"
> {
  children?: React.ReactNode | ((params: { value: UniqueIdentifier }) => React.ReactNode);
}

function SortableOverlay({ children, className, dropAnimation, ...props }: SortableOverlayProps) {
  const { activeId, modifiers, reducedMotion } = useContext(SortableRootContext);
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );
  if (!mounted || activeId === null) return null;

  const content =
    typeof children === "function" ? children({ value: activeId }) : (children ?? null);
  return createPortal(
    <DragOverlay
      {...props}
      dropAnimation={reducedMotion ? null : (dropAnimation ?? DROP_ANIMATION_CONFIG)}
      modifiers={modifiers}
      className={cn("z-50 cursor-grabbing", className)}
    >
      {content}
    </DragOverlay>,
    document.body,
  );
}

export { Sortable, SortableItem, SortableItemHandle, SortableOverlay };
