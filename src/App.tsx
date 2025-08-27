import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider } from './contexts/AuthContext';
import { AppearanceProvider } from './contexts/AppearanceContext';
import AppearanceClassManager from './components/AppearanceClassManager';
import { GlobalSegmentationStatus } from './components/GlobalSegmentationStatus';

import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import CreateProject from "./pages/CreateProject";
import ProjectPlatform from "./pages/ProjectPlatform";
import SitesManagement from "./pages/SitesManagement";
import CreateSite from "./pages/CreateSite";
import SegmentationPage from "./pages/SegmentationPage";

import BirdNetAEDPage from "./pages/BirdNetAEDPage";
import AudioClusteringPage from "./pages/AudioClusteringPage";

import AnnotationPage from "./pages/AnnotationPage";
import VolunteerAnnotationPage from "./pages/VolunteerAnnotationPage";
import PlatformAnnotationPage from "./pages/PlatformAnnotationPage";
import PublicAnnotationPage from "./pages/PublicAnnotationPage";
import Home from "./pages/Home";
import ProtectedRoute from "./components/ProtectedRoute";

const queryClient = new QueryClient();

function App() {
  return (
    <GoogleOAuthProvider clientId="89573306003-f5sto78de7rb873rg4v0qi49r05r8tlu.apps.googleusercontent.com">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <AppearanceProvider>
              <AppearanceClassManager />
            <Router>
              <Routes>
                {/* Public Routes */}
                <Route path="/" element={<Home />} />

                {/* Protected Routes */}
                <Route path="/dashboard" element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } />
                
                <Route path="/create-project" element={
                  <ProtectedRoute>
                    <CreateProject />
                  </ProtectedRoute>
                } />

                <Route path="/projects/:projectId" element={
                  <ProtectedRoute>
                    <ProjectPlatform />
                  </ProtectedRoute>
                } />

                <Route path="/projects/:projectId/sites" element={
                  <ProtectedRoute>
                    <SitesManagement />
                  </ProtectedRoute>
                } />

                <Route path="/projects/:projectId/sites/create" element={
                  <ProtectedRoute>
                    <CreateSite />
                  </ProtectedRoute>
                } />

                <Route path="/projects/:projectId/segmentation" element={
                  <ProtectedRoute>
                    <SegmentationPage />
                  </ProtectedRoute>
                } />





                <Route path="/projects/:projectId/annotation" element={
                  <ProtectedRoute>
                    <AnnotationPage />
                  </ProtectedRoute>
                } />

                <Route path="/projects/:projectId/annotation/volunteer" element={
                  <ProtectedRoute>
                    <VolunteerAnnotationPage />
                  </ProtectedRoute>
                } />

                <Route path="/projects/:projectId/annotation/platform" element={
                  <ProtectedRoute>
                    <PlatformAnnotationPage />
                  </ProtectedRoute>
                } />

                <Route path="/projects/:projectId/annotation/public" element={
                  <ProtectedRoute>
                    <PublicAnnotationPage />
                  </ProtectedRoute>
                } />



                <Route path="/birdnet-aed" element={
                  <ProtectedRoute>
                    <BirdNetAEDPage />
                  </ProtectedRoute>
                } />

                <Route path="/recordings/:recordingId/birdnet-aed" element={
                  <ProtectedRoute>
                    <BirdNetAEDPage />
                  </ProtectedRoute>
                } />

                <Route path="/projects/:projectId/clustering" element={
                  <ProtectedRoute>
                    <AudioClusteringPage />
                  </ProtectedRoute>
                } />

                <Route path="/projects/:projectId/clustering/:recordingId" element={
                  <ProtectedRoute>
                    <AudioClusteringPage />
                  </ProtectedRoute>
                } />

                <Route path="/profile" element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                } />

                <Route path="/settings" element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                } />

                {/* Catch all route */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Router>
            </AppearanceProvider>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
