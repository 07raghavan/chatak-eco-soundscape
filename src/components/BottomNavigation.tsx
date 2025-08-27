import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { 
  BarChart3, 
  Upload, 
  MapPin, 
  Scissors, 
  Network, 
  FileText, 
  Brain, 
  Search, 
  BarChart4,
  Home,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bird
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppearance } from "@/contexts/AppearanceContext";

interface BottomNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  requiresProject?: boolean;
  isCenter?: boolean;
}

const bottomNavItems: BottomNavItem[] = [
  {
    id: "segmentation",
    label: "Segmentation",
    icon: Scissors,
    path: "/segmentation",
    requiresProject: true
  },
  {
    id: "birdnet-aed",
    label: "AED",
    icon: Bird,
    path: "/birdnet-aed",
    requiresProject: false
  },
  {
    id: "clustering",
    label: "Clustering",
    icon: Network,
    path: "/clustering",
    requiresProject: true
  },
  {
    id: "annotations",
    label: "Annotations",
    icon: FileText,
    path: "/annotation",
    requiresProject: true
  },
  {
    id: "dashboard",
    label: "Dashboard",
    icon: Home,
    path: "/dashboard",
    isCenter: true
  },
  {
    id: "manage",
    label: "Manage",
    icon: Settings,
    path: "",
    requiresProject: true
  },
  {
    id: "models",
    label: "Models",
    icon: Brain,
    path: "/models",
    requiresProject: true
  },
  {
    id: "pattern-matching",
    label: "Pattern Matching",
    icon: Search,
    path: "/pattern-matching",
    requiresProject: true
  },
  {
    id: "insights",
    label: "Insights",
    icon: BarChart4,
    path: "/insights",
    requiresProject: true
  }
];

interface BottomNavigationProps {
  projectId?: string;
}

const BottomNavigation = ({ projectId }: BottomNavigationProps) => {
  const { transparencyEnabled } = useAppearance();
  const base = transparencyEnabled ? "bg-white/60 backdrop-blur-md border-t border-white/30" : "bg-white border-t border-green-100";
  
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(() => {
    const path = location.pathname;
    if (path === "/dashboard") return "dashboard";
    if (path.includes("/projects/")) return "manage";
    if (path.includes("/segmentation")) return "segmentation";
    if (path.includes("/birdnet-aed")) return "birdnet-aed";
    if (path.includes("/clustering")) return "clustering";
    if (path.includes("/annotation")) return "annotations";
    if (path.includes("/models")) return "models";
    if (path.includes("/pattern-matching")) return "pattern-matching";
    if (path.includes("/insights")) return "insights";
    return "dashboard";
  });

  useEffect(() => {
    const path = location.pathname;
    if (path === "/dashboard") return setActiveTab("dashboard");
    if (path.includes("/projects/")) return setActiveTab("manage");
    if (path.includes("/segmentation")) return setActiveTab("segmentation");
    if (path.includes("/birdnet-aed")) return setActiveTab("birdnet-aed");
    if (path.includes("/clustering")) return setActiveTab("clustering");
    if (path.includes("/annotation")) return setActiveTab("annotations");
    if (path.includes("/models")) return setActiveTab("models");
    if (path.includes("/pattern-matching")) return setActiveTab("pattern-matching");
    if (path.includes("/insights")) return setActiveTab("insights");
    setActiveTab("dashboard");
  }, [location.pathname]);

  const handleTabClick = async (item: BottomNavItem) => {
    setActiveTab(item.id);
    
    // Handle navigation for different item types
    if (item.id === "dashboard") {
      navigate("/dashboard");
      return;
    }
    
    if (item.id === "birdnet-aed") {
      navigate("/birdnet-aed");
      return;
    }
    
    // For project-specific items, check if we have a project context
    if (item.requiresProject) {
      if (projectId) {
        if (item.id === "manage") {
          navigate(`/projects/${projectId}`);
        } else if (item.path === "") {
          navigate(`/projects/${projectId}`);
        } else {
          navigate(`/projects/${projectId}${item.path}`);
        }
      } else {
        // No project context, navigate to dashboard
        navigate("/dashboard");
      }
      return;
    }
    
    // Default fallback
    navigate(item.path);
  };

  // Filter items based on whether we're in a project context
  const visibleItems = projectId 
    ? bottomNavItems 
    : bottomNavItems.filter(item => !item.requiresProject);

  return (
    <div className={"fixed bottom-0 left-0 right-0 z-50 shadow-lg glass-nav " + base}>
      <div className="container mx-auto">
        <div className="flex items-center justify-between py-2.5 px-2">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => handleTabClick(item)}
                className={cn(
                  "flex flex-col items-center justify-center py-2 px-2 transition-all duration-200",
                  "hover:bg-green-50 rounded-lg group flex-1",
                   isActive 
                    ? (transparencyEnabled ? "text-green-700 bg-white/60" : "text-green-700 bg-green-50") 
                    : "text-gray-700 hover:text-green-700"
                )}
              >
                <div className={cn(
                  "relative p-2 rounded-full transition-all duration-200",
                  isActive 
                    ? (transparencyEnabled ? "bg-white/40 backdrop-blur-sm text-green-700 ring-1 ring-white/40 shadow-sm" : "bg-green-100 text-green-700")
                    : (transparencyEnabled ? "hover:bg-white/60 backdrop-blur-sm group-hover:scale-105 bg-white/30" : "hover:bg-green-50 group-hover:scale-105"),
                  item.isCenter && (transparencyEnabled ? "text-green-800 ring-2 ring-white/50 shadow-md p-3" : "bg-green-200 text-green-800 ring-2 ring-green-300 p-3")
                )}>
                  <Icon className={cn(
                    "transition-all duration-200",
                    isActive ? "scale-110" : "scale-100",
                    item.isCenter ? "w-6 h-6" : "w-5 h-5"
                  )} />
                  
                  {/* Active indicator */}
                  {isActive && !item.isCenter && (
                    <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-green-600 rounded-full animate-pulse" />
                  )}
                </div>
                
                <span className={cn(
                  "text-xs font-medium mt-1 transition-all duration-200 truncate max-w-full text-center",
                  isActive ? "text-green-600 font-semibold" : "text-gray-500",
                  item.isCenter && "font-semibold text-green-700"
                )}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      
      {/* Gradient overlay for visual appeal */}
      <div className="absolute inset-0 bg-gradient-to-t from-green-50/40 to-transparent pointer-events-none" />
      
      {/* Bottom safe area for mobile devices */}
      <div className="h-1 bg-green-50" />
    </div>
  );
};

export default BottomNavigation;