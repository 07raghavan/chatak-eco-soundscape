import { useState, useEffect } from "react";
import EcoForestBackground from "@/components/EcoForestBackground";
import { Plus, Calendar, Users, BarChart3, ArrowRight, Play, Pause, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PlatformNav } from "@/components/PlatformNav";
import { BottomNavigation } from "@/components/BottomNavigation";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useAppearance } from "@/contexts/AppearanceContext";

import { API_BASE_URL } from "@/lib/api";

interface Project {
  id: number;
  name: string;
  description: string;
  start_date: string;
  end_date: string | null;
  is_ongoing: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  sites_count: number;
  recordings_count: number;
}

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const { transparencyEnabled } = useAppearance();

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/projects`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }

      const data = await response.json();
      setProjects(data.projects);
    } catch (error) {
      console.error('Error fetching projects:', error);
      setError('Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <Play className="w-4 h-4 text-green-500" />;
      case 'paused':
        return <Pause className="w-4 h-4 text-yellow-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-blue-500" />;
      default:
        return <Play className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="min-h-screen relative">
      <EcoForestBackground />
      <div className="relative z-10">
      <PlatformNav />
      
      <main className="container mx-auto px-6 py-8 pb-24">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Dashboard</h1>
            <p className="text-muted-foreground">Welcome back, {user?.name || 'User'}!</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Profile Card */}
            <div className="lg:col-span-1">
              <Card className={(transparencyEnabled ? "glass-card " : "") + (transparencyEnabled ? "bg-white/60 backdrop-blur-md border-white/30 shadow-eco" : "bg-card border-border")}>
                <CardHeader className="text-center">
                  <Avatar className="w-20 h-20 mx-auto mb-4">
                    <AvatarImage src="/placeholder-avatar.jpg" alt={user?.name} />
                    <AvatarFallback className="bg-coral text-white text-2xl">
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="text-lg font-semibold">{user?.name || 'User'}</h3>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                    {user?.organization && (
                      <p className="text-sm text-muted-foreground mt-1">{user.organization}</p>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Quick Stats */}
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-coral">{projects.length}</div>
                      <div className="text-xs text-muted-foreground">Projects</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-coral">0</div>
                      <div className="text-xs text-muted-foreground">Recordings</div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="space-y-2">
                    <Button 
                      onClick={() => navigate("/create-project")}
                      className="w-full bg-coral hover:bg-coral/90 text-white"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      New Project
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => navigate("/profile")}
                      className="w-full"
                    >
                      Edit Profile
                    </Button>
                  </div>

                  {/* Recent Activity */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">Recent Activity</h4>
                    <div className="space-y-2 text-xs">
                      {projects.slice(0, 3).map((project) => (
                        <div key={project.id} className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-coral rounded-full"></div>
                          <span className="text-muted-foreground">
                            Created "{project.name}"
                          </span>
                        </div>
                      ))}
                      {projects.length === 0 && (
                        <div className="text-muted-foreground">
                          No recent activity
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Projects Section */}
            <div className="lg:col-span-3">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">My Projects</h2>
                  <p className="text-muted-foreground">Manage your acoustic monitoring projects</p>
                </div>
                <Button 
                  onClick={() => navigate("/create-project")}
                  className="bg-coral hover:bg-coral/90 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New Project
                </Button>
              </div>

              {isLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-coral mx-auto"></div>
                  <p className="mt-2 text-muted-foreground">Loading projects...</p>
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <p className="text-red-600">{error}</p>
                  <Button 
                    onClick={fetchProjects}
                    variant="outline"
                    className="mt-2"
                  >
                    Try Again
                  </Button>
                </div>
              ) : projects.length === 0 ? (
                <Card className={(transparencyEnabled ? "glass-card " : "") + (transparencyEnabled ? "bg-white/60 backdrop-blur-md border-white/30 shadow-eco" : "bg-card border-border")}>
                  <CardContent className="text-center py-12">
                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                      <BarChart3 className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">No projects yet</h3>
                    <p className="text-muted-foreground mb-4">
                      Create your first acoustic monitoring project to get started
                    </p>
                    <Button 
                      onClick={() => navigate("/create-project")}
                      className="bg-coral hover:bg-coral/90 text-white"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Create Your First Project
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {projects.map((project) => (
                    <Card key={project.id} className={(transparencyEnabled ? "glass-card bg-white/60 backdrop-blur-md border-white/30" : "bg-card border-border") + " hover:shadow-md transition-shadow cursor-pointer"} onClick={() => navigate(`/projects/${project.id}`)}>
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <CardTitle className="text-lg mb-2">{project.name}</CardTitle>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {project.description || 'No description provided'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(project.status)}
                            <Badge className={getStatusColor(project.status)}>
                              {project.status}
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {/* Project Stats */}
                          <div className="grid grid-cols-2 gap-4">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-muted-foreground" />
                              <div>
                                <div className="text-sm font-medium">Start Date</div>
                                <div className="text-xs text-muted-foreground">
                                  {formatDate(project.start_date)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-muted-foreground" />
                              <div>
                                <div className="text-sm font-medium">Sites</div>
                                <div className="text-xs text-muted-foreground">
                                  {project.sites_count} sites
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Project Progress */}
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>Recordings</span>
                              <span>{project.recordings_count}</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2">
                              <div 
                                className="bg-coral h-2 rounded-full transition-all"
                                style={{ width: `${Math.min((project.recordings_count / 100) * 100, 100)}%` }}
                              ></div>
                            </div>
                          </div>

                          {/* Project Actions */}
                          <div className="flex gap-2">
                            <Button 
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/projects/${project.id}`);
                              }}
                              variant="outline"
                              size="sm"
                              className="flex-1"
                            >
                              Open Project
                              <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <BottomNavigation />
      </div>
    </div>
  );
};

export default Dashboard;