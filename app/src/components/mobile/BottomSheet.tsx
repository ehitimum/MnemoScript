import { useRef, useState, type ReactNode } from 'react';

interface BottomSheetProps {
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Reusable mobile bottom sheet: dimmed backdrop, rounded top, a drag handle that
 * dismisses when pulled down. Theme-aware via the `.mn-sheet*` rules in index.css.
 *
 * Mount this only while it should be visible (callers render it conditionally),
 * so each open starts with fresh drag state — no reset effects needed.
 */
function BottomSheet({ onClose, title, children }: BottomSheetProps) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    setDragY(0);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    const dy = e.clientY - startY.current;
    if (dy > 0) setDragY(dy);
  };
  const onPointerUp = () => {
    if (startY.current == null) return;
    if (dragY > 110) onClose();
    else setDragY(0);
    startY.current = null;
  };

  return (
    <>
      <div className="mn-sheet-backdrop" onClick={onClose} />
      <div
        className="mn-sheet"
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="flex-0 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div className="mn-sheet-handle" />
          {title && (
            <div className="px-5 pb-3 pt-1 text-sm font-semibold text-foreground/90">{title}</div>
          )}
        </div>
        <div className="overflow-y-auto px-5 pb-6">{children}</div>
      </div>
    </>
  );
}

export default BottomSheet;
