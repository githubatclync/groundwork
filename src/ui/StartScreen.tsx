// Shown in the layers panel while nothing is open: how to get started, plus recent projects.
import { pickGeodataFiles } from '../io/import';
import { openPaths } from '../layers/openPaths';
import { basename, dirname } from '../project/paths';
import { PROJECT_SUFFIX } from '../project/projectFile';
import { useSettings } from '../settings/settingsStore';

export function StartScreen() {
  const recent = useSettings((s) => s.recentProjects);

  const openFilesDialog = async () => {
    const paths = await pickGeodataFiles();
    if (paths.length) await openPaths(paths);
  };
  const openProjectDialog = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const chosen = await open({
      multiple: false,
      filters: [{ name: 'Groundwork project', extensions: ['json'] }],
    });
    if (typeof chosen === 'string') await openPaths([chosen]);
  };

  return (
    <div className="start-screen">
      <p className="muted">
        Drop a KML, KMZ, GeoJSON, GPX, or CSV file on the window, or open one to get started.
      </p>
      <div className="start-actions">
        <button type="button" onClick={() => void openFilesDialog()}>
          Open files…
        </button>
        <button type="button" onClick={() => void openProjectDialog()}>
          Open project…
        </button>
      </div>
      {recent.length > 0 && (
        <>
          <h3>Recent projects</h3>
          <ul className="plain recent-list" aria-label="Recent projects">
            {recent.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className="link-button"
                  title={p}
                  onClick={() => void openPaths([p])}
                >
                  <strong>{basename(p).replace(PROJECT_SUFFIX, '')}</strong>
                  <span className="muted small">{dirname(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
