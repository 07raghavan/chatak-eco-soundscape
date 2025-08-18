import { useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';
import Map, { Marker, NavigationControl, LngLatBoundsLike } from 'react-map-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Site {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
}

interface MultiSiteMapComponentProps {
  sites: Site[];
  height?: string;
}

const MultiSiteMapComponent = ({ sites, height = "400px" }: MultiSiteMapComponentProps) => {
  const mapRef = useRef<any>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (sites.length === 0) {
      map.flyTo({ center: [0, 20], zoom: 1.5 });
      return;
    }

    if (sites.length === 1) {
      const s = sites[0];
      const lon = Number(s.longitude);
      const lat = Number(s.latitude);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        map.flyTo({ center: [lon, lat], zoom: 12 });
      }
      return;
    }

    // Compute bounds from min/max
    const longitudes = sites.map(s => Number(s.longitude)).filter(Number.isFinite);
    const latitudes = sites.map(s => Number(s.latitude)).filter(Number.isFinite);
    if (longitudes.length === 0 || latitudes.length === 0) return;

    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);

    const bounds: LngLatBoundsLike = [[minLng, minLat], [maxLng, maxLat]];
    map.fitBounds(bounds, { padding: 60, duration: 800 });
  }, [sites]);

  if (sites.length === 0) {
    return (
      <div className="h-96 bg-muted rounded-lg flex items-center justify-center">
        <div className="text-center">
          <MapPin className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-2">No sites to display</p>
          <p className="text-sm text-muted-foreground">
            Create sites to see them on the map
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border rounded-lg overflow-hidden" style={{ height }}>
        <Map
          ref={mapRef}
          mapLib={import('maplibre-gl')}
          initialViewState={{ longitude: 0, latitude: 20, zoom: 2 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        >
          <NavigationControl position="top-right" />
          {sites.map((site) => (
            <Marker key={site.id} latitude={Number(site.latitude)} longitude={Number(site.longitude)} anchor="bottom">
              <div className="w-3 h-3 bg-coral rounded-full ring-2 ring-white" title={site.name} />
            </Marker>
          ))}
        </Map>
      </div>
      
      {/* Sites List with better styling */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sites.map((site, index) => (
          <div key={site.id} className="p-4 border rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-coral rounded-full flex items-center justify-center text-white text-xs font-medium">
                  {index + 1}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm truncate">{site.name}</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {Number(site.latitude).toFixed(6)}, {Number(site.longitude).toFixed(6)}
                </p>
                {site.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {site.description}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Summary */}
      <div className="text-center text-sm text-muted-foreground">
        Showing {sites.length} site{sites.length !== 1 ? 's' : ''} on the map
      </div>
    </div>
  );
};

export default MultiSiteMapComponent; 