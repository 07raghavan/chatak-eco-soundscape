import React from "react";
import { useAppearance } from "@/contexts/AppearanceContext";

type Props = {
  imageSrc?: string; // defaults to /back.jpeg in public
};

const EcoForestBackground: React.FC<Props> = ({ imageSrc = "/back.jpeg" }) => {
  const { backgroundEnabled, backgroundImage } = useAppearance();
  const src = backgroundImage || imageSrc;

  if (!backgroundEnabled) return null;

  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* main background image */}
      <div
        className="absolute inset-0 bg-cover bg-center scale-[1.02]"
        style={{
          backgroundImage: `url(${src})`,
          filter: "saturate(0.7) brightness(0.65) contrast(0.95)",
        }}
        aria-hidden
      />

      {/* soft green wash to make it slightly dull */}
      <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/20 via-emerald-900/30 to-emerald-900/40 mix-blend-multiply" />

      {/* subtle vignette and top glow */}
      <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_50%_10%,rgba(0,128,0,0.18),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_50%,rgba(0,0,0,0.25),transparent)]" />
    </div>
  );
};

export default EcoForestBackground;


