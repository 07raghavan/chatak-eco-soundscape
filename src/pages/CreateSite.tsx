import { useState, useEffect } from "react";
import EcoForestBackground from "@/components/EcoForestBackground";
import { useParams, useNavigate } from "react-router-dom";
import { MapPin, Save, ArrowLeft, Map, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PlatformNav } from "@/components/PlatformNav";
import InteractiveMapComponent from "@/components/InteractiveMapComponent";
import { API_BASE_URL } from "@/lib/api";
import { useAppearance } from "@/contexts/AppearanceContext";

interface Project {
  id: number;
  name: string;
  description: string;
}

const CreateSite = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const { transparencyEnabled } = useAppearance();
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    latitude: "",
    longitude: ""
  });

  useEffect(() => {
    if (projectId) {
      fetchProject();
    }
  }, [projectId]);

  const fetchProject = async () => {
    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch project');
      }

      const data = await response.json();
      setProject(data.project);
    } catch (error) {
      console.error('Error fetching project:', error);
      setError('Failed to load project');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    // Basic validation
    if (!formData.name.trim()) {
      setError("Site name is required");
      setIsLoading(false);
      return;
    }

    if (!formData.latitude || !formData.longitude) {
      setError("Latitude and longitude are required");
      setIsLoading(false);
      return;
    }

    if (isNaN(parseFloat(formData.latitude)) || isNaN(parseFloat(formData.longitude))) {
      setError("Please enter valid coordinates");
      setIsLoading(false);
      return;
    }

    try {
      const token = localStorage.getItem('chatak_token');
      
      const requestBody = {
        name: formData.name,
        description: formData.description,
        latitude: parseFloat(formData.latitude),
        longitude: parseFloat(formData.longitude)
      };

      console.log('Sending site data:', requestBody);

      const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/sites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();
      
      if (!response.ok) {
        const errorMessage = data.error || 'Failed to create site';
        throw new Error(errorMessage);
      }

      console.log('Site created successfully:', data);
      navigate(`/projects/${projectId}/sites`);
    } catch (error) {
      console.error('Create site error:', error);
      setError(error instanceof Error ? error.message : 'Failed to create site');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLocationSelect = (lat: number, lng: number) => {
    setFormData({
      ...formData,
      latitude: lat.toFixed(6),
      longitude: lng.toFixed(6)
    });
  };

  if (!project) {
    return (
      <div className="min-h-screen relative">
        <EcoForestBackground />
        <div className="relative z-10">
        <PlatformNav />
        <div className="container mx-auto px-6 py-8">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-coral mx-auto"></div>
            <p className="mt-2 text-muted-foreground">Loading project...</p>
          </div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      <EcoForestBackground />
      <div className="relative z-10">
      <PlatformNav />
      
      <main className="container mx-auto px-6 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <Button 
              variant="ghost" 
              onClick={() => navigate(`/projects/${projectId}/sites`)}
              className="mb-4"
              disabled={isLoading}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Sites
            </Button>
            <h1 className="text-3xl font-bold text-foreground mb-2">Create New Site</h1>
            <p className="text-muted-foreground">
              Add a monitoring site to {project.name}
            </p>
          </div>

          {/* Main Content - Side by Side Layout */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {/* Form Section */}
            <div className="space-y-6">
              <Card className={transparencyEnabled ? "glass-card bg-white/60" : "bg-card border-border"}>
                <CardHeader>
                  <CardTitle className="text-xl flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-coral" />
                    Site Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-6">
                    {error && (
                      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                        {error}
                      </div>
                    )}

                    {/* Site Name */}
                    <div>
                      <Label htmlFor="name" className="text-sm font-medium">
                        Site Name *
                      </Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., Forest Edge Site A"
                        className="mt-2"
                        required
                        disabled={isLoading}
                      />
                    </div>

                    {/* Site Description */}
                    <div>
                      <Label htmlFor="description" className="text-sm font-medium">
                        Site Description
                      </Label>
                      <Textarea
                        id="description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Describe the site location, habitat type, and monitoring setup..."
                        className="mt-2"
                        rows={4}
                        disabled={isLoading}
                      />
                    </div>

                    {/* Location Coordinates */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="latitude" className="text-sm font-medium">
                          Latitude *
                        </Label>
                        <Input
                          id="latitude"
                          type="number"
                          step="any"
                          value={formData.latitude}
                          onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                          placeholder="e.g., 60.1699"
                          className="mt-2"
                          required
                          disabled={isLoading}
                          min="-90"
                          max="90"
                        />
                      </div>

                      <div>
                        <Label htmlFor="longitude" className="text-sm font-medium">
                          Longitude *
                        </Label>
                        <Input
                          id="longitude"
                          type="number"
                          step="any"
                          value={formData.longitude}
                          onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                          placeholder="e.g., 24.9384"
                          className="mt-2"
                          required
                          disabled={isLoading}
                          min="-180"
                          max="180"
                        />
                      </div>
                    </div>

                    {/* Form Actions */}
                    <div className="flex gap-4 pt-6">
                      <Button
                        type="submit"
                        className="bg-coral hover:bg-coral/90 text-white"
                        disabled={!formData.name || !formData.latitude || !formData.longitude || isLoading}
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {isLoading ? "Creating..." : "Create Site"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => navigate(`/projects/${projectId}/sites`)}
                        disabled={isLoading}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* Map Section */}
            <div className="space-y-6">
              <Card className={(transparencyEnabled ? "glass-card bg-white/60 " : "") + "border-border h-full"}>
                <CardHeader>
                  <CardTitle className="text-xl flex items-center gap-2">
                    <Map className="w-5 h-5 text-coral" />
                    Interactive Location Selection
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Use the map below to select coordinates or enter them manually in the form
                  </p>
                </CardHeader>
                <CardContent>
                  <InteractiveMapComponent
                    latitude={formData.latitude ? parseFloat(formData.latitude) : undefined}
                    longitude={formData.longitude ? parseFloat(formData.longitude) : undefined}
                    onLocationSelect={handleLocationSelect}
                    height="500px"
                  />
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

export default CreateSite; 