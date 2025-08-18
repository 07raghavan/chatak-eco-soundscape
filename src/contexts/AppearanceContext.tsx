import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type AppearanceState = {
  backgroundEnabled: boolean;
  transparencyEnabled: boolean;
  backgroundImage: string; // path under public
  setBackgroundEnabled: (value: boolean) => void;
  setTransparencyEnabled: (value: boolean) => void;
  setBackgroundImage: (value: string) => void;
};

const DEFAULTS = {
  backgroundEnabled: true,
  transparencyEnabled: true,
  backgroundImage: "/back.jpeg",
};

const STORAGE_KEYS = {
  bg: "chatak_bg_enabled",
  translucency: "chatak_transparency_enabled",
  img: "chatak_bg_image",
};

const AppearanceContext = createContext<AppearanceState | undefined>(undefined);

export const AppearanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [backgroundEnabled, setBackgroundEnabled] = useState<boolean>(DEFAULTS.backgroundEnabled);
  const [transparencyEnabled, setTransparencyEnabled] = useState<boolean>(DEFAULTS.transparencyEnabled);
  const [backgroundImage, setBackgroundImage] = useState<string>(DEFAULTS.backgroundImage);

  // Load from localStorage once
  useEffect(() => {
    try {
      const bg = localStorage.getItem(STORAGE_KEYS.bg);
      const tr = localStorage.getItem(STORAGE_KEYS.translucency);
      const img = localStorage.getItem(STORAGE_KEYS.img);
      if (bg !== null) setBackgroundEnabled(bg === "true");
      if (tr !== null) setTransparencyEnabled(tr === "true");
      if (img) setBackgroundImage(img);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist changes
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.bg, String(backgroundEnabled)); } catch {}
  }, [backgroundEnabled]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.translucency, String(transparencyEnabled)); } catch {}
  }, [transparencyEnabled]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.img, backgroundImage); } catch {}
  }, [backgroundImage]);

  const value = useMemo<AppearanceState>(() => ({
    backgroundEnabled,
    transparencyEnabled,
    backgroundImage,
    setBackgroundEnabled,
    setTransparencyEnabled,
    setBackgroundImage,
  }), [backgroundEnabled, transparencyEnabled, backgroundImage]);

  return (
    <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
  );
};

export const useAppearance = () => {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within AppearanceProvider");
  return ctx;
};




