import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LogIn, UserPlus } from "lucide-react";
import LoginModal from "./LoginModal";
import RegisterModal from "./RegisterModal";

const GetStarted = () => {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);

  return (
    <section id="get-started" className="py-24 bg-gradient-nature">
      <div className="container mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-section-title text-primary mb-6">
            Get Started Today
          </h2>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
            Ready to transform your biodiversity research? Choose the option that best fits your needs 
            and join the acoustic monitoring revolution.
          </p>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Login Card */}
          <div className="bg-white rounded-2xl p-8 shadow-eco">
            <div className="text-center mb-6">
              <div className="bg-coral/10 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <LogIn className="w-8 h-8 text-coral" />
              </div>
              <h3 className="text-2xl font-semibold text-primary mb-4">
                Welcome Back
              </h3>
              <p className="text-muted-foreground">
                Access your Chatak dashboard and continue your biodiversity monitoring journey.
              </p>
            </div>
            
            <Button 
              onClick={() => setIsLoginOpen(true)}
              className="w-full bg-coral hover:bg-coral/90 text-white text-lg py-3"
            >
              Sign In to Chatak
            </Button>
            
            <p className="text-sm text-muted-foreground mt-4 text-center">
              Secure access to your research data and insights
            </p>
          </div>

          {/* Register Card */}
          <div className="bg-gradient-to-br from-primary/5 to-coral/5 rounded-2xl p-8 border border-primary/10">
            <div className="text-center mb-6">
              <div className="bg-primary/10 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <UserPlus className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-primary mb-4">
                Join Chatak Today
              </h3>
              <p className="text-muted-foreground">
                Start your conservation journey with powerful tools designed for researchers and ecologists.
              </p>
            </div>
            
            <Button 
              onClick={() => setIsRegisterOpen(true)}
              className="w-full bg-primary hover:bg-primary/90 text-white text-lg py-3"
            >
              Create Your Account
            </Button>
            
            <p className="text-sm text-muted-foreground mt-4 text-center">
              Free trial • No credit card required • Full access
            </p>
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

export default GetStarted;