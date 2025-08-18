import { useState } from "react";
import EcoForestBackground from "@/components/EcoForestBackground";
import { Calendar, Save, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { PlatformNav } from "@/components/PlatformNav";
import { useNavigate } from "react-router-dom";
import { useAppearance } from "@/contexts/AppearanceContext";
import { API_BASE_URL } from "@/lib/api";

const CreateProject = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { transparencyEnabled } = useAppearance();
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    startDate: "",
    endDate: "",
    isOngoing: false
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const token = localStorage.getItem('chatak_token');
      
      // Prepare the request body, handling empty strings
      const requestBody: any = {
        name: formData.name,
        description: formData.description,
        start_date: formData.startDate,
        is_ongoing: formData.isOngoing
      };

      // Only include end_date if it's not empty and project is not ongoing
      if (!formData.isOngoing && formData.endDate) {
        requestBody.end_date = formData.endDate;
      }

      console.log('Sending project data:', requestBody);

      const response = await fetch(`${API_BASE_URL}/api/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create project');
      }

      console.log('Project created successfully:', data);
      navigate("/dashboard");
    } catch (error) {
      console.error('Create project error:', error);
      setError(error instanceof Error ? error.message : 'Failed to create project');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOngoingChange = (checked: boolean) => {
    setFormData({ ...formData, isOngoing: checked });
    if (checked) {
      setFormData(prev => ({ ...prev, endDate: "" }));
    }
  };

  return (
    <div className="min-h-screen relative">
      <EcoForestBackground />
      <div className="relative z-10">
      <PlatformNav />
      
      <main className="container mx-auto px-6 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <Button 
              variant="ghost" 
              onClick={() => navigate("/dashboard")}
              className="mb-4"
              disabled={isLoading}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <h1 className="text-3xl font-bold text-foreground mb-2">Create New Project</h1>
            <p className="text-muted-foreground">Set up a new acoustic monitoring project</p>
          </div>

          <Card className={transparencyEnabled ? "glass-card bg-white/60" : "bg-card border-border"}>
            <CardHeader>
              <CardTitle className="text-xl">Project Details</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                    {error}
                  </div>
                )}

                {/* Project Name */}
                <div>
                  <Label htmlFor="name" className="text-sm font-medium">
                    Project Name *
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Brown bears in Eastern Finland"
                    className="mt-2"
                    required
                    disabled={isLoading}
                  />
                </div>

                {/* Project Description */}
                <div>
                  <Label htmlFor="description" className="text-sm font-medium">
                    Project Description
                  </Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe your project goals, methodology, and expected outcomes..."
                    className="mt-2"
                    rows={4}
                    disabled={isLoading}
                  />
                </div>

                {/* Project Dates */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="startDate" className="text-sm font-medium">
                      Project Start Date *
                    </Label>
                    <div className="relative mt-2">
                      <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                      <Input
                        id="startDate"
                        type="date"
                        value={formData.startDate}
                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                        className="pl-10"
                        required
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="endDate" className="text-sm font-medium">
                      Project End Date
                    </Label>
                    <div className="relative mt-2">
                      <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                      <Input
                        id="endDate"
                        type="date"
                        value={formData.endDate}
                        onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                        className="pl-10"
                        disabled={formData.isOngoing || isLoading}
                        min={formData.startDate}
                      />
                    </div>
                  </div>
                </div>

                {/* Ongoing Project Checkbox */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="isOngoing"
                    checked={formData.isOngoing}
                    onCheckedChange={handleOngoingChange}
                    disabled={isLoading}
                  />
                  <Label htmlFor="isOngoing" className="text-sm font-medium">
                    This is an on-going project
                  </Label>
                </div>

                {formData.isOngoing && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-700">
                      End date will be set automatically when you mark the project as completed.
                    </p>
                  </div>
                )}

                {/* Form Actions */}
                <div className="flex gap-4 pt-6">
                  <Button
                    type="submit"
                    className="bg-coral hover:bg-coral/90 text-white"
                    disabled={!formData.name || !formData.startDate || isLoading}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {isLoading ? "Creating..." : "Create Project"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate("/dashboard")}
                    disabled={isLoading}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
      </div>
    </div>
  );
};

export default CreateProject; 