// Root component: toolbar, layers panel, globe, status bar, settings dialog, and drag-and-drop.
import { useEffect, useState } from 'react';
import { GlobeView } from './globe/GlobeView';
import { getLaunchFiles, listenForDrops } from './io/import';
import { openFiles, startLayerManager } from './layers/layerManager';
import { useSettings } from './settings/settingsStore';
import { AttributeTable } from './table/AttributeTable';
import { useSelection } from './selection/selectionStore';
import { Attribution } from './ui/Attribution';
import { FeatureDetails } from './ui/FeatureDetails';
import { LayersPanel } from './ui/LayersPanel';
import { SettingsDialog } from './ui/SettingsDialog';
import { StatusBar } from './ui/StatusBar';
import { MeasurePanel } from './ui/MeasurePanel';
import { Toolbar } from './ui/Toolbar';
import { measureModeOf, useTool } from './tools/toolStore';
import { useToolKeys } from './tools/useToolKeys';
import { useUi } from './ui/uiStore';

// Launch files must open once even though React StrictMode runs effects twice in development.
let launchFilesHandled = false;

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const init = useSettings((s) => s.init);
  const tableOpen = useUi((s) => s.tableOpen);
  const detailsOpen = useUi((s) => s.detailsOpen);
  const hasSelection = useSelection((s) => s.selection !== null);
  const measuring = useTool((s) => measureModeOf(s.tool) !== null);
  useToolKeys();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => startLayerManager(), []);

  // Files passed on the command line ("Open with…") open at startup.
  useEffect(() => {
    if (launchFilesHandled) return;
    launchFilesHandled = true;
    void getLaunchFiles()
      .then((paths) => (paths.length ? openFiles(paths) : undefined))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listenForDrops((paths) => void openFiles(paths), setDropHover).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="app">
      <Toolbar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="workspace">
        <LayersPanel />
        <div className="center">
          <main className={`globe-wrap${measuring ? ' measuring' : ''}`}>
            <GlobeView />
            <Attribution />
            {dropHover && <div className="drop-overlay">Drop files to open</div>}
          </main>
          {tableOpen && <AttributeTable />}
        </div>
        {measuring ? <MeasurePanel /> : detailsOpen && hasSelection && <FeatureDetails />}
      </div>
      <StatusBar />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
