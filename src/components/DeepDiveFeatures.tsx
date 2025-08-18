import { useState } from "react";
import { 
  Mic, 
  Database, 
  MapPin, 
  TrendingUp, 
  AlertTriangle, 
  Share2, 
  Download, 
  Settings, 
  Smartphone 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import LoginModal from "./LoginModal";
import RegisterModal from "./RegisterModal";

const deepFeatures = [
  {
    icon: Mic,
    title: "Capture & Ingest",
    description: "Instant drag-and-drop uploader with live progress feedback. Smart metadata auto-fill (site, time, device) or manual override. Bulk upload support for multi-gigabyte recording sets."
  },
  {
    icon: Database,
    title: "Clip Segmentation",
    description: "Automated splitting into user-defined intervals (e.g., 30 s, 1 min). Quality filters remove silent or noisy segments without manual work. Preview library of valid clips before analysis."
  },
  {
    icon: AlertTriangle,
    title: "Event Detection & Extraction",
    description: "Configurable thresholds for amplitude, duration, and frequency bands. Real-time spectrogram previews with highlighted Regions of Interest. Confidence scoring to prioritize high-value events."
  },
  {
    icon: Share2,
    title: "Annotation & Collaboration",
    description: "Assign annotation campaigns to teams or individuals. Dynamic playlist generation ensuring balanced workload. Smart questions and taxonomy support for consistent labeling. Live leaderboards and progress heatmaps to motivate contributors."
  },
  {
    icon: TrendingUp,
    title: "Clustering & Visualization",
    description: "Automatic grouping of similar vocalizations with 'one-click' cluster creation. Interactive 2D map of embeddings—zoom, pan, and drill into clusters. Play audio snippets in context to validate cluster quality."
  },
  {
    icon: Settings,
    title: "Custom Model Training",
    description: "Guided workflow: select labeled data → configure parameters → launch training. Monitor model accuracy and loss curves in real time. One-click deployment: run inference on new uploads or historical archives."
  },
  {
    icon: MapPin,
    title: "Pattern Matching",
    description: "Upload a reference call or browse existing clips for 'find-similar' searches. High-speed similarity engine to scan entire libraries in seconds. Adjustable similarity threshold and results ranking."
  },
  {
    icon: Download,
    title: "Soundscape Monitoring",
    description: "Automated computation of ecological indices (ACI, ASU, NDSI). Interactive time-series charts with site-and-date filters. Heatmaps showing acoustic activity hotspots across your sites."
  },
  {
    icon: Smartphone,
    title: "Reporting & Insights",
    description: "Pre-built dashboards summarizing species presence, annotation stats, and index trends. Customizable CSV/Excel exports for easy sharing. Scheduled email reports to keep your team and stakeholders informed."
  }
];

const DeepDiveFeatures = () => {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  return (
    <section className="py-24 forest-depth">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-section-title text-white mb-6">
            Deep Dive into Features
          </h2>
          <p className="text-lg text-white/80 max-w-3xl mx-auto">
            Explore the comprehensive suite of tools and capabilities that make Chatak 
            the leading platform for acoustic-based biodiversity monitoring and research.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
          {deepFeatures.map((feature, index) => (
            <div 
              key={index}
              className="bg-white/10 backdrop-blur-sm rounded-xl p-8 border border-white/20 hover:border-coral/50 transition-all duration-300 group"
            >
              <div className="bg-coral/20 rounded-lg w-14 h-14 flex items-center justify-center mb-6 group-hover:bg-coral/30 transition-colors">
                <feature.icon className="w-7 h-7 text-coral" />
              </div>
              
              <h3 className="text-xl font-semibold text-white mb-4">
                {feature.title}
              </h3>
              
              <p className="text-white/70 leading-relaxed">
                {feature.description}
              </p>

              {/* Feature highlight bar */}
              <div className="mt-6 h-1 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-coral to-coral-glow rounded-full"
                  style={{ width: '20%' }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Interactive demo section */}
        <div className="mt-20 text-center">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 border border-white/20">
            <h3 className="text-2xl font-semibold text-white mb-4">
              Experience Chatak in Action
            </h3>
            <p className="text-white/70 mb-6 max-w-2xl mx-auto">
              Ready to transform your biodiversity research? Get started with Chatak today.
            </p>
            
            {/* Login/Register buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Button 
                size="lg" 
                className="bg-coral hover:bg-coral/90 text-white font-semibold px-8 py-3"
                onClick={() => setIsLoginOpen(true)}
              >
                Sign In to Chatak
              </Button>
              <Button 
                size="lg" 
                className="bg-white text-primary hover:bg-white/90 font-semibold px-8 py-3"
                onClick={() => setIsRegisterOpen(true)}
              >
                Create Your Account
              </Button>
            </div>
          </div>
        </div>
      </div>

      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onSwitchToRegister={() => {
          setIsLoginOpen(false);
          setIsRegisterOpen(true);
        }}
      />
      <RegisterModal
        isOpen={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
        onSwitchToLogin={() => {
          setIsRegisterOpen(false);
          setIsLoginOpen(true);
        }}
      />
    </section>
  );
};

export default DeepDiveFeatures;