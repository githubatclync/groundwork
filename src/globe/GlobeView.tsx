// Mounts the Cesium viewer with the default basemap and a visible attribution.
// Cesium-specific code is kept inside src/globe/.
import { useEffect, useRef } from 'react';
import { Viewer, UrlTemplateImageryProvider, ImageryLayer } from 'cesium';
import { DEFAULT_BASEMAP } from './basemaps';

export function GlobeView() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const viewer = new Viewer(ref.current, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      timeline: false,
      animation: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: document.createElement('div'),
    });
    viewer.imageryLayers.add(
      new ImageryLayer(
        new UrlTemplateImageryProvider({
          url: DEFAULT_BASEMAP.url,
          maximumLevel: DEFAULT_BASEMAP.maxZoom,
        }),
      ),
    );
    return () => viewer.destroy();
  }, []);

  return (
    <>
      <div ref={ref} className="globe" />
      <div className="attribution">{DEFAULT_BASEMAP.attribution}</div>
    </>
  );
}
