import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Twitter, Linkedin, Github, Mail, CheckCircle } from "lucide-react";
import { useState } from "react";

const Footer = () => {
  const [email, setEmail] = useState("");
  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setIsSubscribed(true);
      setTimeout(() => {
        setIsSubscribed(false);
        setEmail("");
      }, 2000);
    }
  };

  return (
    <footer className="bg-primary text-primary-foreground">
      {/* Newsletter Section */}
      <div className="border-b border-primary-glow/20">
        <div className="container mx-auto px-6 py-16">
          <div className="max-w-2xl mx-auto text-center">
            <h3 className="text-2xl font-semibold mb-4">
              Stay Connected with Nature's Voice
            </h3>
            <p className="text-primary-foreground/80 mb-8">
              Get weekly insights on biodiversity trends, new species discoveries, 
              and conservation success stories powered by acoustic monitoring.
            </p>
            
            <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-4 max-w-md mx-auto">
              <Input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/60 focus:border-coral"
                required
              />
              <Button 
                type="submit"
                className="bg-coral hover:bg-coral/90 text-coral-foreground font-medium px-6"
                disabled={isSubscribed}
              >
                {isSubscribed ? (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Subscribed!
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4 mr-2" />
                    Subscribe
                  </>
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Main Footer Content */}
      <div className="container mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          
          {/* Brand Section */}
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-coral rounded-lg flex items-center justify-center">
                <span className="text-coral-foreground font-bold text-lg">C</span>
              </div>
              <span className="text-xl font-bold">Chatak</span>
            </div>
            <p className="text-primary-foreground/80 mb-6 leading-relaxed">
              Transforming environmental soundscapes into actionable biodiversity insights 
              for a more sustainable future.
            </p>
            <div className="flex gap-4">
              <a 
                href="#" 
                className="bg-white/10 rounded-lg w-10 h-10 flex items-center justify-center hover:bg-coral/20 transition-colors group"
              >
                <Twitter className="w-5 h-5 group-hover:text-coral transition-colors" />
              </a>
              <a 
                href="#" 
                className="bg-white/10 rounded-lg w-10 h-10 flex items-center justify-center hover:bg-coral/20 transition-colors group"
              >
                <Linkedin className="w-5 h-5 group-hover:text-coral transition-colors" />
              </a>
              <a 
                href="#" 
                className="bg-white/10 rounded-lg w-10 h-10 flex items-center justify-center hover:bg-coral/20 transition-colors group"
              >
                <Github className="w-5 h-5 group-hover:text-coral transition-colors" />
              </a>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h4 className="font-semibold text-lg mb-6">Product</h4>
            <ul className="space-y-3">
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Features
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Pricing
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  API Documentation
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Mobile App
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Hardware Solutions
                </a>
              </li>
            </ul>
          </div>

          {/* Company Links */}
          <div>
            <h4 className="font-semibold text-lg mb-6">Company</h4>
            <ul className="space-y-3">
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  About Us
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Research Team
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Careers
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Press Kit
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Partners
                </a>
              </li>
            </ul>
          </div>

          {/* Support Links */}
          <div>
            <h4 className="font-semibold text-lg mb-6">Support</h4>
            <ul className="space-y-3">
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Help Center
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Contact Us
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Community Forum
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  Training & Tutorials
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/80 hover:text-coral transition-colors">
                  System Status
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-primary-glow/20">
        <div className="container mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-primary-foreground/60 text-sm">
              © 2024 Chatak Eco Acoustic Platform. All rights reserved.
            </div>
            <div className="flex gap-6 text-sm">
              <a href="#" className="text-primary-foreground/60 hover:text-coral transition-colors">
                Privacy Policy
              </a>
              <a href="#" className="text-primary-foreground/60 hover:text-coral transition-colors">
                Terms of Service
              </a>
              <a href="#" className="text-primary-foreground/60 hover:text-coral transition-colors">
                Cookie Policy
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;