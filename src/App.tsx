// Root component: toolbar, globe, status bar, and the settings dialog.
import { useEffect, useState } from 'react';
import { GlobeView } from './globe/GlobeView';
import { useSettings } from './settings/settingsStore';
import { Attribution } from './ui/Attribution';
import { SettingsDialog } from './ui/SettingsDialog';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const init = useSettings((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <Toolbar onOpenSettings={() => setSettingsOpen(true)} />
      <main className="globe-wrap">
        <GlobeView />
        <Attribution />
      </main>
      <StatusBar />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
