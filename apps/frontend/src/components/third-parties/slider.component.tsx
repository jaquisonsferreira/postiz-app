import {
  FC,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@gitroom/frontend/components/ui/icons';

const SWIPE_DISTANCE = 40;

export const SliderComponent: FC<{
  className: string;
  list: ReactNode[];
  dots?: boolean;
  onChange?: (index: number) => void;
}> = ({ className, list, dots = true, onChange }) => {
  const [show, setShow] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<number | null>(null);
  const swiped = useRef(false);

  const goTo = useCallback(
    (index: number) => {
      const next = Math.min(Math.max(index, 0), list.length - 1);
      setShow(next);
      onChange?.(next);
      container.current?.focus({ preventScroll: true });
    },
    [list.length, onChange]
  );

  const goToPrevious = useCallback(() => goTo(show - 1), [goTo, show]);
  const goToNext = useCallback(() => goTo(show + 1), [goTo, show]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToPrevious();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToNext();
      }
    },
    [goToPrevious, goToNext]
  );

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    swipeStart.current = event.clientX;
  }, []);

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (swipeStart.current === null) {
        return;
      }
      const distance = event.clientX - swipeStart.current;
      swipeStart.current = null;
      swiped.current = Math.abs(distance) >= SWIPE_DISTANCE;
      if (distance <= -SWIPE_DISTANCE) {
        goToNext();
      }
      if (distance >= SWIPE_DISTANCE) {
        goToPrevious();
      }
    },
    [goToNext, goToPrevious]
  );

  const onClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (swiped.current) {
      swiped.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  const canGoPrevious = show > 0;
  const canGoNext = show < list.length - 1;

  return (
    <div
      ref={container}
      tabIndex={list.length > 1 ? 0 : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipeStart.current = null)}
      onClickCapture={onClickCapture}
      onDragStart={(event) => event.preventDefault()}
      className={clsx(className, 'relative select-none touch-pan-y outline-none')}
    >
      {list[show]}

      {canGoPrevious && (
        <button
          type="button"
          onClick={goToPrevious}
          className="absolute top-[50%] start-[10px] -translate-y-[50%] flex items-center justify-center w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors backdrop-blur-sm cursor-pointer"
          aria-label="Previous slide"
        >
          <ChevronLeftIcon size={18} />
        </button>
      )}

      {canGoNext && (
        <button
          type="button"
          onClick={goToNext}
          className="absolute top-[50%] end-[10px] -translate-y-[50%] flex items-center justify-center w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors backdrop-blur-sm cursor-pointer"
          aria-label="Next slide"
        >
          <ChevronRightIcon size={18} />
        </button>
      )}

      {dots && list.length > 1 && (
        <div className="absolute bottom-[10px] left-[50%] -translate-x-[50%] flex gap-2 px-[8px] py-[6px] rounded-full bg-black/40 backdrop-blur-sm">
          {list.map((_, index) => (
            <button
              type="button"
              key={index}
              onClick={() => goTo(index)}
              className={clsx(
                'w-2 h-2 rounded-full transition-colors cursor-pointer',
                index === show
                  ? 'bg-white'
                  : 'bg-transparent border border-white'
              )}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};
