// Root component: toolbar, layers panel, globe, status bar, dialogs, drag-and-drop, and shortcuts.
import { useEffect, useState } from 'react';
import { GlobeView } from './globe/GlobeView';
import { getLaunchFiles, listenForDrops } from './io/import';
import { startLayerManager } from './layers/layerManager';
import { openPaths } from './layers/openPaths';
import { useUserLayer } from './layers/userLayerStore';
import { linkSelections } from './selection/selectionLink';
import { useSelection } from './selection/selectionStore';
import { useSettings } from './settings/settingsStore';
import { AttributeTable } from './table/AttributeTable';
import { drawKindOf } from './tools/draftStore';
import { measureModeOf, useTool } from './tools/toolStore';
import { useToolKeys } from './tools/useToolKeys';
import { Attribution } from './ui/Attribution';
import { ExportDialog } from './ui/ExportDialog';
import { FeatureDetails } from './ui/FeatureDetails';
import { ImageExportDialog } from './ui/ImageExportDialog';
import { LayersPanel } from './ui/LayersPanel';
import { MeasurePanel } from './ui/MeasurePanel';
import { PlaceEditor } from './ui/PlaceEditor';
import { CsvImportDialog, LocateDialog } from './ui/PromptDialogs';
import { SettingsDialog } from './ui/SettingsDialog';
import { ShortcutsDialog } from './ui/ShortcutsDialog';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';
import { useUi } from './ui/uiStore';
import { useShortcuts } from './ui/useShortcuts';

// Launch files must open once even though React StrictMode runs effects twice in development.
let launchFilesHandled = false;

export function App() {
  const [dropHover, setDropHover] = useState(false);
  const init = useSettings((s) => s.init);
  const tableOpen = useUi((s) => s.tableOpen);
  const detailsOpen = useUi((s) => s.detailsOpen);
  const dialog = useUi((s) => s.dialog);
  const setDialog = useUi((s) => s.setDialog);
  const hasSelection = useSelection((s) => s.selection !== null);
  const measuring = useTool((s) => measureModeOf(s.tool) !== null);
  const userSelected = useUserLayer((s) => s.selectedId !== null);
  const placeTool = useTool((s) => drawKindOf(s.tool) !== null || s.tool === 'edit');
  const placeEditing = userSelected || placeTool;
  const drawing = useTool((s) => s.tool !== 'none');
  useToolKeys();
  useShortcuts();
  useEffect(() => linkSelections(), []);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => startLayerManager(), []);

  // Files passed on the command line ("Open with…") open at startup. Settings load first so a
  // project's basemap choice is not overwritten by the defaults loading afterwards.
  useEffect(() => {
    if (launchFilesHandled) return;
    launchFilesHandled = true;
    void init()
      .then(() => getLaunchFiles())
      .then((paths) => (paths.length ? openPaths(paths) : undefined))
      .catch(() => undefined);
  }, [init]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listenForDrops((paths) => void openPaths(paths), setDropHover).then((fn) => {
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
      <Toolbar
        onOpenSettings={() => setDialog('settings')}
        onExport={() => setDialog('export')}
        onExportImage={() => setDialog('image')}
        onHelp={() => setDialog('shortcuts')}
      />
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
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'image' && <ImageExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      <LocateDialog />
      <CsvImportDialog />
    </div>
  );
}
