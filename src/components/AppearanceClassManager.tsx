import { useEffect } from "react";
import { useAppearance } from "@/contexts/AppearanceContext";

const AppearanceClassManager = () => {
  const { transparencyEnabled } = useAppearance();

  useEffect(() => {
    const cls = "glass-mode";
    const body = document.body;
    if (transparencyEnabled) body.classList.add(cls);
    else body.classList.remove(cls);
    return () => body.classList.remove(cls);
  }, [transparencyEnabled]);

  return null;
};

export default AppearanceClassManager;




