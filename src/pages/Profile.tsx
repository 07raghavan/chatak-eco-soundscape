import { useState } from "react";
import { User, Mail, Building, Camera, Save, X, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PlatformNav } from "@/components/PlatformNav";
import EcoForestBackground from "@/components/EcoForestBackground";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "@/lib/api";
import { useAppearance } from "@/contexts/AppearanceContext";

const Profile = () => {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { transparencyEnabled } = useAppearance();
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    name: user?.name || "",
    organization: user?.organization || ""
  });

  const handleSave = async () => {
    setIsLoading(true);
    setError("");

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/users/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: formData.name,
          organization: formData.organization
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update profile');
      }

      // Update the auth context with new user data
      const updatedUser = { ...user, ...data.user };
      login(token!, updatedUser);
      
      setIsEditing(false);
      console.log('Profile updated successfully:', data);
    } catch (error) {
      console.error('Profile update error:', error);
      setError(error instanceof Error ? error.message : 'Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      name: user?.name || "",
      organization: user?.organization || ""
    });
    setError("");
    setIsEditing(false);
  };

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
            <h1 className="text-3xl font-bold text-foreground mb-2">Profile</h1>
            <p className="text-muted-foreground">Manage your account information and preferences</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Profile Picture Section */}
            <div className="lg:col-span-1">
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "bg-card border-border"}>
                <CardHeader>
                  <CardTitle className="text-lg">Profile Picture</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                  <div className="flex justify-center mb-4">
                    <Avatar className="w-24 h-24">
                      <AvatarImage src="/placeholder-avatar.jpg" alt={user?.name} />
                      <AvatarFallback className="bg-coral text-white text-3xl">
                        {user?.name?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <Button variant="outline" className="w-full border-coral text-coral hover:bg-coral/10">
                    <Camera className="w-4 h-4 mr-2" />
                    Change Photo
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Profile Information */}
            <div className="lg:col-span-2">
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "bg-card border-border"}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Profile Information</CardTitle>
                    {!isEditing ? (
                      <Button 
                        onClick={() => setIsEditing(true)}
                        className="bg-coral hover:bg-coral/90 text-white"
                      >
                        Edit Profile
                      </Button>
                    ) : (
                      <div className="flex gap-2">
                        <Button 
                          onClick={handleSave}
                          className="bg-coral hover:bg-coral/90 text-white"
                          disabled={isLoading}
                        >
                          <Save className="w-4 h-4 mr-2" />
                          {isLoading ? "Saving..." : "Save"}
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={handleCancel}
                          disabled={isLoading}
                        >
                          <X className="w-4 h-4 mr-2" />
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                      {error}
                    </div>
                  )}

                  {/* Name Field */}
                  <div>
                    <Label htmlFor="name" className="text-sm font-medium flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Full Name *
                    </Label>
                    {isEditing ? (
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="mt-2"
                        placeholder="Enter your full name"
                        disabled={isLoading}
                      />
                    ) : (
                      <p className="text-foreground mt-2">{user?.name || "Not provided"}</p>
                    )}
                  </div>

                  {/* Email Field - Read Only */}
                  <div>
                    <Label htmlFor="email" className="text-sm font-medium flex items-center gap-2">
                      <Mail className="w-4 h-4" />
                      Email Address
                    </Label>
                    <p className="text-foreground mt-2">{user?.email || "Not provided"}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Email address cannot be changed for security reasons
                    </p>
                  </div>

                  {/* Organization Field */}
                  <div>
                    <Label htmlFor="organization" className="text-sm font-medium flex items-center gap-2">
                      <Building className="w-4 h-4" />
                      Organization
                    </Label>
                    {isEditing ? (
                      <Input
                        id="organization"
                        value={formData.organization}
                        onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                        className="mt-2"
                        placeholder="Enter your organization (optional)"
                        disabled={isLoading}
                      />
                    ) : (
                      <p className="text-foreground mt-2">{user?.organization || "Not provided"}</p>
                    )}
                  </div>

                  {/* Account Information */}
                  {!isEditing && (
                    <div className="pt-6 border-t border-border">
                      <h3 className="text-sm font-medium text-muted-foreground mb-3">Account Information</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Account Type:</span>
                          <span className="text-foreground">Researcher</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Member Since:</span>
                          <span className="text-foreground">January 2024</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Last Login:</span>
                          <span className="text-foreground">Today</span>
                        </div>
                      </div>
                    </div>
                  )}
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

export default Profile; 