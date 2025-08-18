import { useAuth } from "../contexts/AuthContext";
import { Navigate } from "react-router-dom";
import Navigation from "../components/Navigation";
import Hero from "../components/Hero";
import PlatformGlance from "../components/PlatformGlance";
import DeepDiveFeatures from "../components/DeepDiveFeatures";
import WhyChatak from "../components/WhyChatak";
import GetStarted from "../components/GetStarted";
import Footer from "../components/Footer";
import VerticalImageScroller from "@/components/VerticalImageScroller";

const Home = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-coral mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading Chatak...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <Hero />
      <PlatformGlance />
      <DeepDiveFeatures />
      <WhyChatak />
      <GetStarted />
      {/* Vertical scroller at the very end */}
      <VerticalImageScroller />
      <Footer />
    </div>
  );
};

export default Home; 