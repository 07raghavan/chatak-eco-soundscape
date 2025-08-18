import React, { useEffect, useRef, useState } from "react";

const VerticalImageScroller: React.FC = () => {
  const images = Array.from({ length: 17 }, (_, index) => `/${index + 1}.png`);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const root = containerRef.current;

    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!best) return;
        const idx = Number((best.target as HTMLElement).dataset.index);
        if (!Number.isNaN(idx)) setActive(idx);
      },
      { root, threshold: [0.35, 0.6, 0.85] }
    );

    itemRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section className="relative py-20 bg-gradient-to-b from-[hsl(var(--secondary))] to-[hsl(var(--muted))]">
      <div className="container">
        <div className="mb-8 text-center">
          <h2 className="text-section-title text-primary">Soundscapes In Focus</h2>
          <p className="mt-2 text-muted-foreground">A flowing glance at field moments</p>
        </div>

        <div className="relative h-[520px] md:h-[640px] overflow-hidden rounded-2xl border border-border shadow-eco bg-card">
          {/* vertical track (manual scroll) */}
          <div ref={containerRef} className="absolute inset-0 overflow-y-auto scrollbar-hide scroll-smooth snap-y snap-mandatory">
            <ul className="flex flex-col gap-6 py-6">
              {images.map((src, idx) => {
                const isActive = active === idx;
                return (
                  <li
                    key={`${src}-${idx}`}
                    ref={(el) => (itemRefs.current[idx] = el)}
                    data-index={idx}
                    className="mx-auto w-[78%] sm:w-[65%] md:w-[52%] lg:w-[46%] snap-center"
                  >
                    <div
                      className={`overflow-hidden rounded-xl border border-border bg-background/60 transition-all duration-500 ease-smooth ${
                        isActive ? "opacity-100 scale-100" : "opacity-70 scale-[0.985]"}
                      `}
                    >
                      <img
                        src={src}
                        alt={`Field image ${idx + 1}`}
                        className={`block w-full h-[260px] md:h-[320px] object-cover transition-all duration-500 ease-smooth ${
                          isActive ? "blur-0" : "blur-[1.5px]"}
                        `}
                        loading={idx < 2 ? "eager" : "lazy"}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* edge fades for reveal feel */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[hsl(var(--card))] to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[hsl(var(--card))] to-transparent" />
        </div>
      </div>
    </section>
  );
};

export default VerticalImageScroller;



