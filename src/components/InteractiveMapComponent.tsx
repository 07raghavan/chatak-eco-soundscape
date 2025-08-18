import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigation, Crosshair, MousePointer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Map, { Marker, NavigationControl, MapLayerMouseEvent } from 'react-map-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface InteractiveMapComponentProps {
  latitude?: number;
  longitude?: number;
  onLocationSelect?: (lat: number, lng: number) => void;
  height?: string;
}

const InteractiveMapComponent = ({ 
  latitude = 0, 
  longitude = 0, 
  onLocationSelect, 
  height = "400px"
}: InteractiveMapComponentProps) => {
  const [selectedLat, setSelectedLat] = useState<number>(latitude);
  const [selectedLng, setSelectedLng] = useState<number>(longitude);
  const [isLoading, setIsLoading] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (latitude && longitude) {
      setSelectedLat(latitude);
      setSelectedLng(longitude);
    }
    // nothing to do; map centers from state
  }, [latitude, longitude]);

  const initialView = useMemo(() => {
    if (selectedLat && selectedLng) {
      return { latitude: selectedLat, longitude: selectedLng, zoom: 12 };
    }
    return { latitude: 20, longitude: 0, zoom: 2 };
  }, [selectedLat, selectedLng]);

  const getCurrentLocation = () => {
    setIsLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setSelectedLat(lat);
          setSelectedLng(lng);
          onLocationSelect?.(lat, lng);
          setIsLoading(false);
        },
        (error) => {
          console.error('Geolocation error:', error);
          alert('Unable to get current location. Please select manually on the map.');
          setIsLoading(false);
        }
      );
    } else {
      alert('Geolocation is not supported by this browser.');
      setIsLoading(false);
    }
  };

  const handleCoordinateInput = () => {
    const lat = prompt('Enter latitude (e.g., 12.995789):');
    const lng = prompt('Enter longitude (e.g., 77.699482):');
    
    if (lat && lng) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      
      if (!isNaN(latNum) && !isNaN(lngNum)) {
        setSelectedLat(latNum);
        setSelectedLng(lngNum);
        onLocationSelect?.(latNum, lngNum);
      }
    }
  };

  const toggleSelectionMode = () => {
    setIsSelecting(!isSelecting);
  };

  const handleMapClick = (e: MapLayerMouseEvent) => {
    if (!isSelecting) return;
    const { lngLat } = e;
    const lat = lngLat.lat;
    const lng = lngLat.lng;
    setSelectedLat(lat);
    setSelectedLng(lng);
    onLocationSelect?.(lat, lng);
    setIsSelecting(false);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex gap-2 mb-4">
        <Button
          onClick={getCurrentLocation}
          disabled={isLoading}
          variant="outline"
          size="sm"
        >
          <Navigation className="w-4 h-4 mr-2" />
          {isLoading ? 'Getting Location...' : 'Get Current Location'}
        </Button>
        <Button
          onClick={handleCoordinateInput}
          variant="outline"
          size="sm"
        >
          <Crosshair className="w-4 h-4 mr-2" />
          Enter Coordinates
        </Button>
        <Button
          onClick={toggleSelectionMode}
          variant={isSelecting ? "default" : "outline"}
          size="sm"
          className={isSelecting ? "bg-coral text-white" : ""}
        >
          <MousePointer className="w-4 h-4 mr-2" />
          {isSelecting ? 'Click on Map' : 'Select on Map'}
        </Button>
      </div>

      {/* Interactive Map */}
      <div className="relative border rounded-lg overflow-hidden" style={{ height }}>
        <Map
          ref={mapRef}
          mapLib={import('maplibre-gl')}
          initialViewState={initialView}
          onClick={handleMapClick}
          style={{ width: '100%', height: '100%' }}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        >
          <NavigationControl position="top-right" />
          {selectedLat && selectedLng && (
            <Marker latitude={selectedLat} longitude={selectedLng} anchor="bottom">
              <div className="w-3 h-3 bg-coral rounded-full ring-2 ring-white" />
            </Marker>
          )}
          <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg shadow-sm">
            <p className="text-sm font-medium text-gray-700">
              {isSelecting
                ? 'Click anywhere on the map to select location'
                : 'Use controls above to select location'}
            </p>
          </div>
        </Map>
      </div>

      {/* Selected Location Display */}
      {selectedLat && selectedLng && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-2">Selected Location</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="font-medium">Latitude:</span>
              <span className="ml-2 text-blue-700">{Number(selectedLat).toFixed(6)}</span>
            </div>
            <div>
              <span className="font-medium">Longitude:</span>
              <span className="ml-2 text-blue-700">{Number(selectedLng).toFixed(6)}</span>
            </div>
          </div>
          <div className="mt-2 text-xs text-blue-600">
            💡 Tip: Use "Get Current Location" for GPS accuracy, "Enter Coordinates" for precise input, or "Select on Map" to click and choose
          </div>
        </div>
      )}
    </div>
  );
};

export default InteractiveMapComponent; 