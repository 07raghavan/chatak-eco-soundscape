import Navigation from "@/components/Navigation";
import Hero from "@/components/Hero";
import PlatformGlance from "@/components/PlatformGlance";
import DeepDiveFeatures from "@/components/DeepDiveFeatures";
import WhyChatak from "@/components/WhyChatak";
import GetStarted from "@/components/GetStarted";
import Footer from "@/components/Footer";
import VerticalImageScroller from "@/components/VerticalImageScroller";

const Index = () => {
  return (
    <div className="min-h-screen">
      <Navigation />
      <div className="pt-16">
        <Hero />
        <section id="platform">
          <PlatformGlance />
        </section>
        <section id="features">
          <DeepDiveFeatures />
        </section>
        <section id="why-chatak">
          <WhyChatak />
        </section>
        <section id="get-started">
          <GetStarted />
        </section>
        {/* Vertical scroller at the very end */}
        <VerticalImageScroller />
        <Footer />
      </div>
    </div>
  );
};

export default Index;
