import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import EcoForestBackground from "@/components/EcoForestBackground";
import { MapPin, Plus, Trash2, Edit, ArrowLeft, Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlatformNav } from "@/components/PlatformNav";
import { useAuth } from "../contexts/AuthContext";
import MultiSiteMapComponent from "@/components/MultiSiteMapComponent";
import { API_BASE_URL } from "@/lib/api";
import { useAppearance } from "@/contexts/AppearanceContext";

interface Site {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
  created_at: string;
  updated_at: string;
}

interface Project {
  id: number;
  name: string;
  description: string;
}

const SitesManagement = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [showMap, setShowMap] = useState(false);
  const { transparencyEnabled } = useAppearance();

  useEffect(() => {
    if (projectId) {
      fetchProject();
      fetchSites();
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

  const fetchSites = async () => {
    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/sites`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch sites');
      }

      const data = await response.json();
      setSites(data.sites);
    } catch (error) {
      console.error('Error fetching sites:', error);
      setError('Failed to load sites');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSite = async (siteId: number) => {
    if (!confirm('Are you sure you want to delete this site?')) {
      return;
    }

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/sites/${siteId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to delete site');
      }

      // Refresh sites list
      fetchSites();
    } catch (error) {
      console.error('Error deleting site:', error);
      alert('Failed to delete site');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen relative">
        <EcoForestBackground />
        <div className="relative z-10">
        <PlatformNav />
        <div className="container mx-auto px-6 py-8">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-coral mx-auto"></div>
            <p className="mt-2 text-muted-foreground">Loading sites...</p>
          </div>
        </div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen relative">
        <EcoForestBackground />
        <div className="relative z-10">
        <PlatformNav />
        <div className="container mx-auto px-6 py-8">
          <div className="text-center py-8">
            <p className="text-red-600">{error || 'Project not found'}</p>
            <Button 
              onClick={() => navigate(`/projects/${projectId}`)}
              variant="outline"
              className="mt-2"
            >
              Back to Project
            </Button>
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
            <div className="flex items-center justify-between">
              <div>
                <Button 
                  variant="ghost" 
                  onClick={() => navigate(`/projects/${projectId}`)}
                  className="mb-4"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Project
                </Button>
                <h1 className="text-3xl font-bold text-foreground mb-2">Site Management</h1>
                <p className="text-muted-foreground">
                  Manage monitoring sites for {project.name}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline"
                  onClick={() => setShowMap(!showMap)}
                >
                  <Map className="w-4 h-4 mr-2" />
                  {showMap ? 'Hide Map' : 'Show Map'}
                </Button>
                <Button 
                  onClick={() => navigate(`/projects/${projectId}/sites/create`)}
                  className="bg-coral hover:bg-coral/90 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Site
                </Button>
              </div>
            </div>
          </div>

                     {/* Map View */}
           {showMap && (
             <Card className={(transparencyEnabled ? "glass-card bg-white/60 " : "") + "mb-8"}>
               <CardHeader>
                 <CardTitle>Sites Map ({sites.length} sites)</CardTitle>
               </CardHeader>
               <CardContent>
                 <MultiSiteMapComponent
                   sites={sites}
                   height="400px"
                 />
               </CardContent>
             </Card>
           )}

          {/* Sites List */}
          <Card className={transparencyEnabled ? "glass-card bg-white/60" : undefined}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Sites ({sites.length})</CardTitle>
                <Badge variant="secondary">
                  {sites.length} site{sites.length !== 1 ? 's' : ''}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {sites.length === 0 ? (
                <div className="text-center py-12">
                  <MapPin className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No sites yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Create your first monitoring site to get started
                  </p>
                  <Button 
                    onClick={() => navigate(`/projects/${projectId}/sites/create`)}
                    className="bg-coral hover:bg-coral/90 text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Your First Site
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {sites.map((site) => (
                    <div key={site.id} className="border rounded-lg p-6 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-semibold">{site.name}</h3>
                            <Badge variant="outline">Active</Badge>
                          </div>
                          <p className="text-muted-foreground mb-3">
                            {site.description || 'No description provided'}
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="font-medium">Latitude:</span>
                              <span className="ml-2 text-muted-foreground">
                                {Number(site.latitude).toFixed(6)}
                              </span>
                            </div>
                            <div>
                              <span className="font-medium">Longitude:</span>
                              <span className="ml-2 text-muted-foreground">
                                {Number(site.longitude).toFixed(6)}
                              </span>
                            </div>
                            <div>
                              <span className="font-medium">Created:</span>
                              <span className="ml-2 text-muted-foreground">
                                {formatDate(site.created_at)}
                              </span>
                            </div>
                            <div>
                              <span className="font-medium">Last Updated:</span>
                              <span className="ml-2 text-muted-foreground">
                                {formatDate(site.updated_at)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => navigate(`/projects/${projectId}/sites/${site.id}/edit`)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleDeleteSite(site.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      </div>
    </div>
  );
};

export default SitesManagement; 