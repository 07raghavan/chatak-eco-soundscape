import { useState, useEffect } from "react";
import EcoForestBackground from "@/components/EcoForestBackground";
import { useParams, useNavigate } from "react-router-dom";
import { MapPin, Plus, Settings, BarChart3, Mic, FileText, Users, Upload, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PlatformNav } from "@/components/PlatformNav";
import { BottomNavigation } from "@/components/BottomNavigation";
import { useAuth } from "../contexts/AuthContext";
import MultiSiteMapComponent from "@/components/MultiSiteMapComponent";
import AudioUploadComponent from "@/components/AudioUploadComponent";
import ProjectEditModal from "@/components/ProjectEditModal";
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
}

interface Site {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
  created_at: string;
  updated_at: string;
}

  interface Recording {
  id: number;
  name: string;
  description: string;
  file_path: string;
  file_size: number;
  duration_seconds: number;
  recording_date: string;
  status: string;
  created_at: string;
  updated_at: string;
  site_name: string;
  site_latitude: number;
  site_longitude: number;
    file_url: string;
    duration_ms?: number | null;
    sample_rate?: number | null;
    channels?: number | null;
}

const ProjectPlatform = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState<'overview' | 'upload' | 'recordings'>('overview');
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { transparencyEnabled } = useAppearance();

  useEffect(() => {
    if (projectId) {
      fetchProject();
      fetchSites();
      fetchRecordings();
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

  const fetchRecordings = async () => {
    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/recordings`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch recordings');
      }

      const data = await response.json();
      setRecordings(data.recordings || []);
    } catch (error) {
      console.error('Error fetching recordings:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
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

  const handleUploadComplete = () => {
    fetchRecordings();
    setActiveView('recordings');
  };

  const handleProjectUpdate = (updatedProject: Partial<Project>) => {
    if (project) {
      setProject({ ...project, ...updatedProject });
    }
  };

  const handleProjectDelete = () => {
    navigate('/dashboard');
  };

  const handleDeleteRecording = async (recordingId: number) => {
    try {
      setIsDeleting(true);
      const token = localStorage.getItem('chatak_token');
      const res = await fetch(`${API_BASE_URL}/api/recordings/${recordingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete recording');
      }
      setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
    } catch (e) {
      console.error('Failed to delete recording:', e);
      alert((e as Error).message);
    } finally {
      setIsDeleting(false);
      setConfirmDeleteId(null);
    }
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
            <p className="mt-2 text-muted-foreground">Loading project...</p>
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
              onClick={() => navigate("/dashboard")}
              variant="outline"
              className="mt-2"
            >
              Back to Dashboard
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
      
      <main className="container mx-auto px-6 py-8 pb-24">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div>
                <Button 
                  variant="ghost" 
                  onClick={() => navigate("/dashboard")}
                  className="mb-4"
                >
                  ← Back to Dashboard
                </Button>
                <h1 className="text-3xl font-bold text-foreground mb-2">{project.name}</h1>
                <p className="text-muted-foreground">{project.description || 'No description'}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={getStatusColor(project.status)}>
                  {project.status}
                </Badge>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowEditModal(true)}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Button>
              </div>
            </div>
          </div>

          {/* Project Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : undefined}>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <MapPin className="w-8 h-8 text-coral" />
                  <div>
                    <p className="text-2xl font-bold">{sites.length}</p>
                    <p className="text-sm text-muted-foreground">Sites</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={transparencyEnabled ? "glass-card bg-white/60" : undefined}>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <Mic className="w-8 h-8 text-coral" />
                  <div>
                    <p className="text-2xl font-bold">{recordings.length}</p>
                    <p className="text-sm text-muted-foreground">Recordings</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={transparencyEnabled ? "glass-card bg-white/60" : undefined}>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-8 h-8 text-coral" />
                  <div>
                    <p className="text-2xl font-bold">0</p>
                    <p className="text-sm text-muted-foreground">Analyses</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={transparencyEnabled ? "glass-card bg-white/60" : undefined}>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <Users className="w-8 h-8 text-coral" />
                  <div>
                    <p className="text-2xl font-bold">1</p>
                    <p className="text-sm text-muted-foreground">Members</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Navigation Tabs */}
          <div className="flex space-x-1 mb-6">
            <Button
              variant={activeView === 'overview' ? 'default' : 'ghost'}
              onClick={() => setActiveView('overview')}
              className={activeView === 'overview' ? 'bg-coral hover:bg-coral/90 text-white' : 'hover:bg-coral/10 text-coral'}
            >
              Overview
            </Button>
            <Button
              variant={activeView === 'upload' ? 'default' : 'ghost'}
              onClick={() => setActiveView('upload')}
              className={activeView === 'upload' ? 'bg-coral hover:bg-coral/90 text-white' : 'hover:bg-coral/10 text-coral'}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Audio
            </Button>
            <Button
              variant={activeView === 'recordings' ? 'default' : 'ghost'}
              onClick={() => setActiveView('recordings')}
              className={activeView === 'recordings' ? 'bg-coral hover:bg-coral/90 text-white' : 'hover:bg-coral/10 text-coral'}
            >
              <Play className="w-4 h-4 mr-2" />
              Recordings ({recordings.length})
            </Button>
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Sidebar - Quick Actions */}
            <div className="lg:col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle>Quick Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start"
                    onClick={() => navigate(`/projects/${projectId}/sites`)}
                  >
                    <MapPin className="w-4 h-4 mr-2" />
                    Manage Sites
                  </Button>
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start"
                    onClick={() => setActiveView('upload')}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Recording
                  </Button>
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start"
                    onClick={() => setActiveView('recordings')}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    View Recordings
                  </Button>
                </CardContent>
              </Card>

              {/* Project Info */}
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Project Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">Start Date</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(project.start_date)}
                    </p>
                  </div>
                  {project.end_date && (
                    <div>
                      <p className="text-sm font-medium">End Date</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(project.end_date)}
                      </p>
                    </div>
                  )}
                  {project.is_ongoing && (
                    <div>
                      <p className="text-sm font-medium">Status</p>
                      <p className="text-sm text-muted-foreground">Ongoing Project</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Main Content Area */}
            <div className="lg:col-span-2">
              {activeView === 'overview' && (
                <Card className="border-coral/20 bg-gradient-to-br from-coral/5 to-orange-50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-coral">Sites Overview</CardTitle>
                      <Button 
                        onClick={() => navigate(`/projects/${projectId}/sites`)}
                        className="bg-coral hover:bg-coral/90 text-white"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Manage Sites
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {sites.length === 0 ? (
                      <div className="text-center py-8">
                        <MapPin className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">No sites yet</h3>
                        <p className="text-muted-foreground mb-4">
                          Create your first monitoring site to get started
                        </p>
                        <Button 
                          onClick={() => navigate(`/projects/${projectId}/sites`)}
                          className="bg-coral hover:bg-coral/90 text-white"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Add Your First Site
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          {sites.length} site{sites.length !== 1 ? 's' : ''} in this project
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {sites.slice(0, 4).map((site) => (
                            <div key={site.id} className="border border-coral/20 rounded-lg p-4 bg-white hover:bg-coral/5 transition-colors">
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="font-medium text-coral">{site.name}</h4>
                                <Button variant="ghost" size="sm" className="text-coral hover:bg-coral/10">
                                  View
                                </Button>
                              </div>
                              <p className="text-sm text-muted-foreground mb-2">
                                {site.description || 'No description'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {Number(site.latitude).toFixed(6)}, {Number(site.longitude).toFixed(6)}
                              </p>
                            </div>
                          ))}
                        </div>
                        
                        {/* Map Preview */}
                        {sites.length > 0 && (
                          <div className="mt-6">
                            <h4 className="font-medium mb-3 text-coral">Sites Map Preview</h4>
                            <MultiSiteMapComponent
                              sites={sites}
                              height="300px"
                            />
                          </div>
                        )}
                        {sites.length > 4 && (
                          <div className="text-center">
                            <Button 
                              variant="outline"
                              onClick={() => navigate(`/projects/${projectId}/sites`)}
                              className="border-coral/30 text-coral hover:bg-coral/10"
                            >
                              View All Sites ({sites.length})
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {activeView === 'upload' && (
                <div>
                  {sites.length === 0 ? (
                    <Card>
                      <CardContent className="text-center py-8">
                        <MapPin className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">No sites available</h3>
                        <p className="text-muted-foreground mb-4">
                          You need to create at least one site before uploading recordings
                        </p>
                        <Button 
                          onClick={() => navigate(`/projects/${projectId}/sites`)}
                          className="bg-coral hover:bg-coral/90 text-white"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Create Your First Site
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <AudioUploadComponent
                      projectId={projectId!}
                      sites={sites}
                      onUploadComplete={handleUploadComplete}
                    />
                  )}
                </div>
              )}

              {activeView === 'recordings' && (
                <Card className="border-coral/20 bg-gradient-to-br from-coral/5 to-orange-50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-coral">Audio Recordings</CardTitle>
                      <Button 
                        onClick={() => setActiveView('upload')}
                        className="bg-coral hover:bg-coral/90 text-white"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Upload New Recording
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {recordings.length === 0 ? (
                      <div className="text-center py-8">
                        <Mic className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">No recordings yet</h3>
                        <p className="text-muted-foreground mb-4">
                          Upload your first audio recording to get started
                        </p>
                        <Button 
                          onClick={() => setActiveView('upload')}
                          className="bg-coral hover:bg-coral/90 text-white"
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Your First Recording
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {recordings.map((recording) => (
                          <div key={recording.id} className="border border-coral/20 rounded-lg p-4 bg-white hover:bg-coral/5 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-medium text-coral">{recording.name}</h4>
                               <div className="flex items-center gap-2">
                                 <Badge variant="outline" className="border-coral/30 text-coral">
                                   {recording.status}
                                 </Badge>
                                 <Button
                                   variant="outline"
                                   size="sm"
                                   className="text-red-600 hover:bg-red-50"
                                   onClick={() => setConfirmDeleteId(recording.id)}
                                   disabled={isDeleting}
                                 >
                                   Delete
                                 </Button>
                               </div>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">
                              {recording.description || 'No description'}
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-muted-foreground">
                              <div>
                                <span className="font-medium">Site:</span> {recording.site_name}
                              </div>
                              <div>
                                <span className="font-medium">Duration:</span> {formatDuration(recording.duration_seconds)}
                              </div>
                              <div>
                                <span className="font-medium">Size:</span> {formatFileSize(recording.file_size)}
                              </div>
                              <div>
                                <span className="font-medium">Date:</span> {formatDate(recording.recording_date)}
                              </div>
                            </div>
                            <div className="mt-3">
                              {/* Build absolute audio URL if backend returned a relative path */}
                              <audio 
                                controls 
                                className="w-full rounded-lg"
                                style={{
                                  '--coral': '#FF6B35',
                                  '--coral-hover': '#E55A2B'
                                } as React.CSSProperties}
                                onError={(e) => {
                                  const src = recording.file_url.startsWith('http') ? recording.file_url : `${API_BASE_URL}${recording.file_url}`;
                                  console.error('Audio playback error:', e);
                                  console.log('Audio URL:', src);
                                }}
                                onLoadStart={() => {
                                  const src = recording.file_url.startsWith('http') ? recording.file_url : `${API_BASE_URL}${recording.file_url}`;
                                  console.log('🎵 Loading audio:', src);
                                }}
                                onCanPlay={() => {
                                  const src = recording.file_url.startsWith('http') ? recording.file_url : `${API_BASE_URL}${recording.file_url}`;
                                  console.log('✅ Audio ready to play:', src);
                                }}
                              >
                                {(() => {
                                  const src = recording.file_url.startsWith('http') ? recording.file_url : `${API_BASE_URL}${recording.file_url}`;
                                  return (
                                    <>
                                      <source src={src} type="audio/mpeg" />
                                      <source src={src} type="audio/wav" />
                                      <source src={src} type="audio/mp3" />
                                    </>
                                  );
                                })()}
                                Your browser does not support the audio element.
                              </audio>
                              {/* File URL hidden intentionally for security/privacy */}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              {/* Confirm Delete Dialog */}
              <Dialog open={confirmDeleteId !== null} onOpenChange={() => setConfirmDeleteId(null)}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete recording?</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    This will permanently delete the audio file and its metadata. This action cannot be undone.
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setConfirmDeleteId(null)} disabled={isDeleting}>Cancel</Button>
                    <Button className="bg-red-600 hover:bg-red-700" disabled={isDeleting} onClick={() => confirmDeleteId && handleDeleteRecording(confirmDeleteId)}>
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </main>

      {/* Project Edit Modal */}
      {project && (
        <ProjectEditModal
          project={project}
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          onUpdate={handleProjectUpdate}
          onDelete={handleProjectDelete}
        />
      )}

      {/* Bottom Navigation */}
      <BottomNavigation projectId={projectId} />
      </div>
    </div>
  );
};

export default ProjectPlatform; 