import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from '../contexts/AuthContext';
import LoginModal from "./LoginModal";
import RegisterModal from "./RegisterModal";

const Navigation = () => {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
  };

  return (
    <>
      <nav className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-primary to-coral rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">C</span>
              </div>
              <span className="font-display text-xl font-bold text-primary">
                Chatak
              </span>
            </Link>

            {/* Navigation Links */}
            <div className="hidden md:flex items-center space-x-8">
              {user ? (
                // Authenticated user navigation
                <>
                  <Link
                    to="/dashboard"
                    className="text-foreground hover:text-coral transition-colors"
                  >
                    Dashboard
                  </Link>
                  <Link
                    to="/projects"
                    className="text-foreground hover:text-coral transition-colors"
                  >
                    Projects
                  </Link>
                  <Link
                    to="/analysis"
                    className="text-foreground hover:text-coral transition-colors"
                  >
                    Analysis
                  </Link>
                </>
              ) : (
                // Public navigation
                <>
                  <a
                    href="#features"
                    className="text-foreground hover:text-coral transition-colors"
                  >
                    Features
                  </a>
                  <a
                    href="#why-chatak"
                    className="text-foreground hover:text-coral transition-colors"
                  >
                    Why Chatak
                  </a>
                  <a
                    href="#get-started"
                    className="text-foreground hover:text-coral transition-colors"
                  >
                    Get Started
                  </a>
                </>
              )}
            </div>

            {/* Auth Buttons */}
            <div className="flex items-center space-x-4">
              {user ? (
                // Authenticated user actions
                <div className="flex items-center space-x-4">
                  <div className="hidden md:flex items-center space-x-2">
                    <div className="w-8 h-8 bg-coral rounded-full flex items-center justify-center">
                      <span className="text-white font-semibold text-sm">
                        {user.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="text-sm">
                      <p className="font-medium text-foreground">{user.name}</p>
                      <p className="text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="border-coral text-coral hover:bg-coral hover:text-white"
                  >
                    Logout
                  </Button>
                </div>
              ) : (
                // Public auth buttons
                <>
                  <Button
                    variant="ghost"
                    onClick={() => setIsLoginOpen(true)}
                    className="text-foreground hover:text-coral"
                  >
                    Sign In
                  </Button>
                  <Button
                    onClick={() => setIsRegisterOpen(true)}
                    className="bg-coral hover:bg-coral/90 text-white"
                  >
                    Register
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Auth Modals */}
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

export default Navigation;