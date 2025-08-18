import { BarChart3, FileAudio, MapPin, Brain, Settings, Database } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProjectBottomNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const navItems = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "recordings", label: "Recordings", icon: FileAudio },
  { id: "analysis", label: "Analysis", icon: Brain },
  { id: "mapping", label: "Mapping", icon: MapPin },
  { id: "data", label: "Data", icon: Database },
  { id: "settings", label: "Settings", icon: Settings },
];

export const ProjectBottomNav = ({ activeTab, onTabChange }: ProjectBottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card/80 backdrop-blur-lg border-t border-border z-40">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-around py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            
            return (
              <Button
                key={item.id}
                variant="ghost"
                size="sm"
                onClick={() => onTabChange(item.id)}
                className={`flex-1 flex flex-col items-center gap-1 h-auto py-3 px-2 rounded-lg ${
                  isActive 
                    ? "text-primary bg-primary/10" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium">{item.label}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};