import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play, Headphones } from "lucide-react";
import LoginModal from "./LoginModal";
import RegisterModal from "./RegisterModal";
import HeroHorizontalSlides from "./HeroHorizontalSlides";

const Hero = () => {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  return (
    <>
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden hero-bg">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="soundwave absolute top-1/4 left-0 w-full h-32 opacity-30" />
        <div className="soundwave absolute top-1/2 left-0 w-full h-24 opacity-20" style={{ animationDelay: '2s' }} />
        <div className="soundwave absolute top-3/4 left-0 w-full h-16 opacity-10" style={{ animationDelay: '4s' }} />
        
        {/* Floating forest elements */}
        <div className="absolute top-20 left-20 w-4 h-4 bg-primary-glow rounded-full animate-float opacity-60" />
        <div className="absolute top-40 right-32 w-6 h-6 bg-coral rounded-full animate-float opacity-40" style={{ animationDelay: '1s' }} />
        <div className="absolute bottom-32 left-1/4 w-3 h-3 bg-primary-glow rounded-full animate-float opacity-50" style={{ animationDelay: '3s' }} />
        <div className="absolute bottom-20 right-20 w-5 h-5 bg-coral rounded-full animate-float opacity-30" style={{ animationDelay: '2s' }} />
        
        {/* Additional floating elements */}
        <div className="absolute top-32 right-1/4 w-2 h-2 bg-primary-glow rounded-full animate-float opacity-45" style={{ animationDelay: '0.5s' }} />
        <div className="absolute top-60 left-1/3 w-4 h-4 bg-coral rounded-full animate-float opacity-35" style={{ animationDelay: '1.5s' }} />
        <div className="absolute bottom-40 right-1/3 w-3 h-3 bg-primary-glow rounded-full animate-float opacity-55" style={{ animationDelay: '2.5s' }} />
        <div className="absolute top-1/3 left-10 w-5 h-5 bg-coral rounded-full animate-float opacity-25" style={{ animationDelay: '3.5s' }} />
        <div className="absolute bottom-60 left-3/4 w-2 h-2 bg-primary-glow rounded-full animate-float opacity-40" style={{ animationDelay: '4.5s' }} />
        <div className="absolute top-3/4 right-10 w-4 h-4 bg-coral rounded-full animate-float opacity-30" style={{ animationDelay: '5s' }} />
        <div className="absolute top-16 left-1/2 w-3 h-3 bg-primary-glow rounded-full animate-float opacity-50" style={{ animationDelay: '1.2s' }} />
        <div className="absolute bottom-16 right-1/2 w-2 h-2 bg-coral rounded-full animate-float opacity-35" style={{ animationDelay: '2.8s' }} />
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-6">
        <div className="mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-center">
          {/* Left: Text */}
          <div className="text-left">
            {/* Main heading */}
            <h1 className="text-hero text-white mb-6 tracking-tight">
              <span className="block">Listen to</span>
              <span className="block text-coral">Nature's Voice</span>
              <span className="block">with Chatak</span>
            </h1>

            {/* Subheadline */}
            <p className="text-xl md:text-2xl text-white/90 mb-10 max-w-2xl leading-relaxed">
              Advanced acoustic monitoring platform that transforms environmental soundscapes into actionable biodiversity insights for researchers, conservationists, and ecosystem guardians.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
              <Button
                size="lg"
                className="coral-glow bg-coral hover:bg-coral/90 text-coral-foreground font-semibold px-8 py-4 text-lg"
                onClick={() => setIsLoginOpen(true)}
              >
                Sign In to Chatak
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button
                size="lg"
                className="bg-white text-primary hover:bg-white/90 font-semibold px-8 py-4 text-lg"
                onClick={() => setIsRegisterOpen(true)}
              >
                <Play className="mr-2 w-5 h-5" />
                Create Account
              </Button>
            </div>
          </div>

          {/* Right: Horizontal Slides */}
          <div className="w-full">
            <HeroHorizontalSlides />
          </div>
        </div>
      </div>

      {/* Bottom gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background/50 to-transparent" />
    </section>

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
  </>
  );
};

export default Hero;