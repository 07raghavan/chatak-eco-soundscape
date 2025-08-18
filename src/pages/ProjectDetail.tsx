import { useState } from "react";
import { ArrowLeft, Play, Download, Share2, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlatformNav } from "@/components/PlatformNav";
import EcoForestBackground from "@/components/EcoForestBackground";
import { ProjectBottomNav } from "@/components/ProjectBottomNav";
import { MetadataProcessor } from "@/components/MetadataProcessor";
import { useAppearance } from "@/contexts/AppearanceContext";

const ProjectDetail = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const { transparencyEnabled } = useAppearance();

  const project = {
    id: 1,
    name: "Costa Rica Rainforest Study",
    description: "Acoustic monitoring of tropical rainforest biodiversity in Manuel Antonio National Park",
    status: "active",
    created: "March 15, 2024",
    location: "Manuel Antonio National Park, Costa Rica",
    duration: "30 days",
    speciesCount: 47,
    recordings: 156,
    totalHours: 248.5
  };

  const recentRecordings = [
    {
      id: 1,
      name: "Dawn Chorus - Day 15",
      duration: "3:47",
      species: 12,
      timestamp: "2024-03-30 06:15:00",
      confidence: 94
    },
    {
      id: 2,
      name: "Night Sounds - Day 14",
      duration: "2:33",
      species: 8,
      timestamp: "2024-03-29 22:30:00",
      confidence: 87
    },
    {
      id: 3,
      name: "Midday Activity - Day 14",
      duration: "4:12",
      species: 15,
      timestamp: "2024-03-29 12:45:00",
      confidence: 91
    }
  ];

  const topSpecies = [
    { name: "Rufous-tailed Hummingbird", count: 45, confidence: 96 },
    { name: "Great Tinamou", count: 38, confidence: 92 },
    { name: "Chestnut-mandibled Toucan", count: 31, confidence: 94 },
    { name: "Three-wattled Bellbird", count: 27, confidence: 89 },
    { name: "Scarlet Macaw", count: 19, confidence: 91 }
  ];

  return (
    <div className="min-h-screen relative pb-20">
      <EcoForestBackground />
      <div className="relative z-10">
      <PlatformNav />
      
      <main className="container mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Projects
          </Button>
        </div>

        {/* Project Info */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">{project.name}</h1>
              <p className="text-muted-foreground mb-4">{project.description}</p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>📍 {project.location}</span>
                <span>📅 {project.created}</span>
                <span>⏱️ {project.duration}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-green-500/20 text-green-400 border-green-500/20">
                {project.status}
              </Badge>
              <Button variant="outline" size="sm">
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
              <Button variant="outline" size="sm">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-border bg-card"}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-foreground">{project.speciesCount}</div>
                <div className="text-sm text-muted-foreground">Species Identified</div>
              </CardContent>
            </Card>
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-border bg-card"}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-foreground">{project.recordings}</div>
                <div className="text-sm text-muted-foreground">Total Recordings</div>
              </CardContent>
            </Card>
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-border bg-card"}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-foreground">{project.totalHours}h</div>
                <div className="text-sm text-muted-foreground">Audio Analyzed</div>
              </CardContent>
            </Card>
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-border bg-card"}>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-foreground">92%</div>
                <div className="text-sm text-muted-foreground">Avg. Confidence</div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Recent Recordings */}
            <div className="lg:col-span-2">
              <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-border bg-card"}>
                <CardHeader>
                  <CardTitle className="text-card-foreground">Recent Recordings</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {recentRecordings.map((recording) => (
                      <div key={recording.id} className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-4">
                          <Button variant="ghost" size="sm" className="w-10 h-10 rounded-full bg-primary/10 hover:bg-primary/20">
                            <Play className="w-4 h-4 text-primary" />
                          </Button>
                          <div>
                            <h4 className="font-medium text-foreground">{recording.name}</h4>
                            <p className="text-sm text-muted-foreground">
                              {recording.species} species • {recording.duration} • {recording.confidence}% confidence
                            </p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm">
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top Species */}
            <div>
              <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-border bg-card"}>
                <CardHeader>
                  <CardTitle className="text-card-foreground">Top Species</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {topSpecies.map((species, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-sm text-foreground">{species.name}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 bg-muted rounded-full h-2">
                              <div
                                className="bg-primary h-2 rounded-full"
                                style={{ width: `${(species.count / 50) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{species.count}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === "data" && (
          <div className="space-y-6">
            <MetadataProcessor onMetadataProcessed={() => {
              // Refresh any data that depends on metadata
              console.log('Metadata processed successfully');
            }} />
          </div>
        )}

        {activeTab === "recordings" && (
          <div className="space-y-6">
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-border bg-card"}>
              <CardHeader>
                <CardTitle className="text-card-foreground">All Recordings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Recordings management interface will be implemented here.</p>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "analysis" && (
          <div className="space-y-6">
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-border bg-card"}>
              <CardHeader>
                <CardTitle className="text-card-foreground">Analysis Tools</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Analysis tools will be implemented here.</p>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "mapping" && (
          <div className="space-y-6">
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-border bg-card"}>
              <CardHeader>
                <CardTitle className="text-card-foreground">Site Mapping</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Site mapping interface will be implemented here.</p>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-6">
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-border bg-card"}>
              <CardHeader>
                <CardTitle className="text-card-foreground">Project Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Project settings will be implemented here.</p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      <ProjectBottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    </div>
  );
};

export default ProjectDetail;