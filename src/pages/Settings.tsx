import { useState } from "react";
import { Moon, Sun, Monitor, Bell, Shield, Palette, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PlatformNav } from "@/components/PlatformNav";
import EcoForestBackground from "@/components/EcoForestBackground";
import { useNavigate } from "react-router-dom";
import { useAppearance } from "@/contexts/AppearanceContext";

const Settings = () => {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [notifications, setNotifications] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const navigate = useNavigate();
  const {
    backgroundEnabled,
    transparencyEnabled,
    backgroundImage,
    setBackgroundEnabled,
    setTransparencyEnabled,
    setBackgroundImage,
  } = useAppearance();

  const candidateImages = [
    "/back.jpeg",
    "/2ndback.jpg",
    "/3rdback.jpg",
    "/4-back.jpg",
    "/5-back.webp",
    "/6th back.jpg",
  ];

  return (
    <div className="min-h-screen relative">
      <EcoForestBackground />
      <div className="relative z-10">
      <PlatformNav />
      
      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <Button 
              variant="ghost" 
              onClick={() => navigate("/dashboard")}
              className="mb-4"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
            <p className="text-muted-foreground">Manage your account preferences and platform settings</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Settings Navigation */}
            <div className="lg:col-span-1">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="ghost" className="w-full justify-start">
                    <Palette className="w-4 h-4 mr-2" />
                    Appearance
                  </Button>
                  <Button variant="ghost" className="w-full justify-start">
                    <Bell className="w-4 h-4 mr-2" />
                    Notifications
                  </Button>
                  <Button variant="ghost" className="w-full justify-start">
                    <Shield className="w-4 h-4 mr-2" />
                    Privacy & Security
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Settings Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Appearance Settings */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="w-5 h-5" />
                    Appearance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <Label className="text-sm font-medium">Theme</Label>
                    <p className="text-sm text-muted-foreground mb-4">
                      Choose your preferred color theme for the platform
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                      <Button
                        variant={theme === "light" ? "default" : "outline"}
                        className="flex flex-col items-center gap-2 h-auto py-4"
                        onClick={() => setTheme("light")}
                      >
                        <Sun className="w-5 h-5" />
                        <span className="text-sm">Light</span>
                      </Button>
                      <Button
                        variant={theme === "dark" ? "default" : "outline"}
                        className="flex flex-col items-center gap-2 h-auto py-4"
                        onClick={() => setTheme("dark")}
                      >
                        <Moon className="w-5 h-5" />
                        <span className="text-sm">Dark</span>
                      </Button>
                      <Button
                        variant={theme === "system" ? "default" : "outline"}
                        className="flex flex-col items-center gap-2 h-auto py-4"
                        onClick={() => setTheme("system")}
                      >
                        <Monitor className="w-5 h-5" />
                        <span className="text-sm">System</span>
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Color Scheme</Label>
                    <p className="text-sm text-muted-foreground mb-4">
                      Current theme uses coral and primary colors
                    </p>
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 bg-coral rounded-full"></div>
                      <div className="w-8 h-8 bg-primary rounded-full"></div>
                      <div className="w-8 h-8 bg-green-500 rounded-full"></div>
                    </div>
                  </div>

                  {/* Background toggle */}
                  <div>
                    <Label className="text-sm font-medium">Forest Background</Label>
                    <p className="text-sm text-muted-foreground mb-2">Enable a subtle forest image behind app content</p>
                    <div className="flex items-center gap-3">
                      <Switch checked={backgroundEnabled} onCheckedChange={setBackgroundEnabled} />
                      <span className="text-sm">{backgroundEnabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  </div>

                  {/* Transparency toggle */}
                  <div>
                    <Label className="text-sm font-medium">Translucent Cards and Nav</Label>
                    <p className="text-sm text-muted-foreground mb-2">Apply glassy translucent style to cards and bottom navigation</p>
                    <div className="flex items-center gap-3">
                      <Switch checked={transparencyEnabled} onCheckedChange={setTransparencyEnabled} />
                      <span className="text-sm">{transparencyEnabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  </div>

                  {/* Background image picker */}
                  <div>
                    <Label className="text-sm font-medium">Background Image</Label>
                    <p className="text-sm text-muted-foreground mb-2">Pick from images in public folder (names containing "back")</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {candidateImages.map((src) => (
                        <button
                          type="button"
                          key={src}
                          onClick={() => setBackgroundImage(src)}
                          className={`relative aspect-[4/3] rounded-lg overflow-hidden border ${backgroundImage === src ? 'border-coral ring-2 ring-coral/40' : 'border-border'}`}
                          title={src}
                        >
                          <img src={src} alt="bg option" className="w-full h-full object-cover" />
                          {backgroundImage === src && (
                            <span className="absolute bottom-1 right-1 text-[10px] px-2 py-0.5 rounded bg-coral text-white">Selected</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Notification Settings */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="w-5 h-5" />
                    Notifications
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-medium">Platform Notifications</Label>
                      <p className="text-sm text-muted-foreground">
                        Receive notifications about project updates and activities
                      </p>
                    </div>
                    <Switch
                      checked={notifications}
                      onCheckedChange={setNotifications}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-medium">Email Notifications</Label>
                      <p className="text-sm text-muted-foreground">
                        Receive email updates for important activities
                      </p>
                    </div>
                    <Switch
                      checked={emailNotifications}
                      onCheckedChange={setEmailNotifications}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Privacy & Security */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Privacy & Security
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">Data Privacy</Label>
                    <p className="text-sm text-muted-foreground">
                      Your data is encrypted and stored securely. We never share your recordings or project data with third parties.
                    </p>
                  </div>
                  
                  <div className="pt-4">
                    <Button variant="outline" className="border-coral text-coral hover:bg-coral/10">
                      Download My Data
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
      </div>
    </div>
  );
};

export default Settings; 