import { Waves, Brain, Shield, BarChart3, Clock, Globe, Users, Zap } from "lucide-react";

const features = [
  {
    icon: Waves,
    title: "Seamless Audio Capture",
    description: "Drag & drop your field recordings or connect your devices for instant uploads"
  },
  {
    icon: Brain,
    title: "Automated Segmentation",
    description: "Break long recordings into precise clips ready for analysis"
  },
  {
    icon: BarChart3,
    title: "Intelligent Event Detection",
    description: "Pinpoint wildlife vocalizations with configurable sensitivity"
  },
  {
    icon: Users,
    title: "Collaborative Annotation",
    description: "Invite teams, assign clips, track progress with real-time leaderboards"
  },
  {
    icon: Clock,
    title: "Advanced Clustering",
    description: "Group similar calls automatically for faster species discovery"
  },
  {
    icon: Globe,
    title: "Interactive Spectrograms",
    description: "Inspect, tag, and review events on an intuitive zoom-and-pan canvas"
  },
  {
    icon: Shield,
    title: "Species Model Training",
    description: "Build and deploy custom recognition models without code"
  },
  {
    icon: Zap,
    title: "Pattern Matching",
    description: "Find matching acoustic patterns across thousands of recordings"
  }
];

const PlatformGlance = () => {
  return (
    <section id="features" className="py-24 bg-gradient-nature">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-section-title text-primary mb-6">
            Platform at a Glance
          </h2>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
            Chatak combines cutting-edge acoustic technology with ecological expertise to deliver 
            the most comprehensive biodiversity monitoring solution available today.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <div 
              key={index}
              className="feature-card rounded-xl p-6 group hover:scale-105 transition-all duration-300"
            >
              <div className="bg-primary/10 rounded-lg w-12 h-12 flex items-center justify-center mb-4 group-hover:bg-coral/20 transition-colors">
                <feature.icon className="w-6 h-6 text-primary group-hover:text-coral transition-colors" />
              </div>
              <h3 className="text-feature-title text-card-foreground mb-3">
                {feature.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-16">
          <div className="inline-flex items-center gap-2 bg-primary/5 rounded-full px-6 py-3">
            <div className="w-2 h-2 bg-coral rounded-full animate-pulse" />
            <span className="text-sm font-medium text-primary">
              Join thousands of researchers already using Chatak
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PlatformGlance;