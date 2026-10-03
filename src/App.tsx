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
import { ExportDialog } from './ui/ExportDialog';
import { MeasurePanel } from './ui/MeasurePanel';
import { PlaceEditor } from './ui/PlaceEditor';
import { useUserLayer } from './layers/userLayerStore';
import { linkSelections } from './selection/selectionLink';
import { drawKindOf } from './tools/draftStore';
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
  const userSelected = useUserLayer((s) => s.selectedId !== null);
  const placeTool = useTool((s) => drawKindOf(s.tool) !== null || s.tool === 'edit');
  const placeEditing = userSelected || placeTool;
  const drawing = useTool((s) => s.tool !== 'none');
  const [exportOpen, setExportOpen] = useState(false);
  useToolKeys();
  useEffect(() => linkSelections(), []);

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
      <Toolbar onOpenSettings={() => setSettingsOpen(true)} onExport={() => setExportOpen(true)} />
      <div className="workspace">
        <LayersPanel />
        <div className="center">
          <main className={`globe-wrap${drawing ? ' measuring' : ''}`}>
            <GlobeView />
            <Attribution />
            {dropHover && <div className="drop-overlay">Drop files to open</div>}
          </main>
          {tableOpen && <AttributeTable />}
        </div>
        {measuring ? (
          <MeasurePanel />
        ) : placeEditing ? (
          <PlaceEditor />
        ) : (
          detailsOpen && hasSelection && <FeatureDetails />
        )}
      </div>
      <StatusBar />
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
