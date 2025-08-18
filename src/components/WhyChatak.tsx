import { CheckCircle, Award, Clock, Users, Zap, Shield } from "lucide-react";

const uniqueSellingPoints = [
  {
    icon: Award,
    title: "User-First Design",
    description: "Clear, intuitive interfaces crafted for ecologists and field researchers"
  },
  {
    icon: Clock,
    title: "Scalable Architecture",
    description: "Handles single-site projects to multi-continental monitoring campaigns"
  },
  {
    icon: Users,
    title: "Team-Centric Workflows",
    description: "Robust role-based access keeps your data secure and organized"
  },
  {
    icon: Zap,
    title: "Rapid Time-to-Insight",
    description: "From upload to report in minutes, not days"
  }
];

const benefits = [
  "Streamlined Audio Workflows: From upload to analysis in minutes, not days",
  "High-Precision Event Detection: Automatically flag wildlife calls with configurable sensitivity",
  "Collaborative Annotation: Scale labeling with team assignments, playlists, and real-time leaderboards",
  "Actionable Reporting: Generate and export clear, stakeholder-ready reports in CSV or Excel"
];

const WhyChatak = () => {
  return (
    <section id="why-chatak" className="py-24 bg-gradient-nature">
      <div className="container mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-section-title text-primary mb-6">
            Why Choose Chatak?
          </h2>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
            Trusted by leading conservation organizations, research institutions, and government agencies 
            for mission-critical biodiversity monitoring and ecosystem protection.
          </p>
        </div>

        {/* Main USPs Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-20">
          <div className="space-y-8">
            {uniqueSellingPoints.map((usp, index) => (
              <div key={index} className="flex gap-4 group">
                <div className="bg-primary/10 rounded-lg w-12 h-12 flex items-center justify-center flex-shrink-0 group-hover:bg-coral/20 transition-colors">
                  <usp.icon className="w-6 h-6 text-primary group-hover:text-coral transition-colors" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-primary mb-2">
                    {usp.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {usp.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Benefits checklist */}
          <div className="bg-white rounded-2xl p-8 shadow-eco">
            <h3 className="text-2xl font-semibold text-primary mb-8">
              What You'll Achieve with Chatak
            </h3>
            <div className="space-y-4">
              {benefits.map((benefit, index) => (
                <div key={index} className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-coral flex-shrink-0 mt-0.5" />
                  <span className="text-foreground leading-relaxed">{benefit}</span>
                </div>
              ))}
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};

export default WhyChatak;