import React, { useEffect, useMemo, useRef, useState } from "react";

const AUTO_MS = 3000; // slightly slower

const HeroHorizontalSlides: React.FC = () => {
  const images = useMemo(() => Array.from({ length: 17 }, (_, i) => `/${i + 1}.png`), []);
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setActive((prev) => (prev + 1) % images.length);
    }, AUTO_MS);
    return () => clearInterval(t);
  }, [images.length]);

  // Shift so initial state highlights the center dot
  const phase = (1 + Math.floor((active / images.length) * 3)) % 3; // 0..2

  const goToPhase = (p: number) => {
    if (p === 0) {
      setActive((prev) => (prev - 1 + images.length) % images.length);
      return;
    }
    if (p === 2) {
      setActive((prev) => (prev + 1) % images.length);
      return;
    }
    const target = Math.round((p / 3) * images.length) % images.length;
    setActive(target);
  };

  const translatePercent = active * 100;

  return (
    <div className="w-full">
      <div className="relative w-full h-[260px] sm:h-[300px] md:h-[360px] lg:h-[420px] overflow-hidden rounded-2xl border border-border bg-card shadow-eco">
        <div
          ref={trackRef}
          className="h-full flex transition-transform duration-900 ease-in-out will-change-transform"
          style={{ transform: `translateX(-${translatePercent}%)` }}
        >
          {images.map((src, idx) => (
            <div key={idx} className="w-full h-full shrink-0 flex items-center justify-center bg-background/70">
              <img
                src={src}
                alt={`Hero image ${idx + 1}`}
                className="block max-h-full max-w-full object-contain"
                loading={idx < 3 ? "eager" : "lazy"}
              />
            </div>
          ))}
        </div>
      </div>

      {/* dots below layout; first and third are permanent arrows */}
      <div className="mt-12 sm:mt-14 flex items-center justify-center gap-4">
        {[0, 1, 2].map((d) => {
          const isPrev = d === 0;
          const isNext = d === 2;
          const isCenter = d === 1;
          const isActiveDot = phase === d;
          return (
            <button
              key={d}
              aria-label={isPrev ? "Previous" : isNext ? "Next" : "Center"}
              onClick={() => goToPhase(d)}
              className={`grid place-items-center h-7 w-7 rounded-full transition-colors duration-300 ${
                isCenter
                  ? isActiveDot
                    ? "bg-transparent ring-2 ring-coral/60"
                    : "bg-transparent"
                  : isActiveDot
                    ? "bg-coral text-coral-foreground"
                    : "bg-foreground/30 hover:bg-foreground/60 text-foreground"
              }`}
            >
              {isPrev ? (
                <span className="text-sm font-semibold leading-none">◀</span>
              ) : isNext ? (
                <span className="text-sm font-semibold leading-none">▶</span>
              ) : (
                <span className={`block h-2.5 w-2.5 rounded-full ${isActiveDot ? "bg-coral" : "bg-foreground/60"}`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default HeroHorizontalSlides;


