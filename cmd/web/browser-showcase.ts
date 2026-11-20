import { showcaseRoot, type Showcase } from './browser-options.ts';
import { BrowserProject, type ProjectDependencies, type ResolutionProgress, type Store } from './browser-project.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
const generationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function removeGeneration(store: Store, path: string) {
  try { await store.remove(path); }
  catch (error) {
    if ((error as {code?:string}).code !== 'ENOENT') console.warn('Could not remove old showcase files', path, error);
  }
}

export async function openShowcase(store: Store, showcase: Showcase, corsProxy: string | undefined,
    onProgress: (snapshot: ResolutionProgress) => void, dependencies?: ProjectDependencies) {
  const root = `${showcaseRoot}/${showcase.id}`;
  const current = `${root}/current`;
  let generation: string;
  if (showcase.zip) generation = crypto.randomUUID();
  else {
    try { generation = decoder.decode(await store.read(current)); }
    catch (error) {
      if ((error as {code?:string}).code !== 'ENOENT') throw error;
      throw new Error(`No saved ${showcase.id} demo. Open its fresh launch link first.`);
    }
    if (!generationId.test(generation)) throw new Error('Invalid saved showcase location.');
  }
  const cwd = `${root}/${generation}`;
  const project = new BrowserProject(store, {cwd, config:'gams.json', modulesDir:`${cwd}/gams_modules`, pluginCacheDir:'/cache/jco', corsProxy}, dependencies);
  project.onProgress = onProgress;
  try {
    if (showcase.zip) await project.importShowcaseArchive(showcase.zip);
    const result = await project.load();
    await store.mkdir(project.options.modulesDir);
    await store.mkdir(project.options.pluginCacheDir);
    const pending = showcase.zip ? {
      async commit() {
        // OPFS commits this small file on close; never remove the previous
        // generation before that commit or before the new UI has started.
        await store.write(current, encoder.encode(generation));
        try {
          for (const name of await store.list(root)) {
            if (name !== generation && generationId.test(name)) await removeGeneration(store, `${root}/${name}`);
          }
        } catch (error) { console.warn('Could not list old showcase generations', error); }
      },
      discard: () => removeGeneration(store, cwd),
    } : undefined;
    return {project, result, pending};
  } catch (error) {
    if (showcase.zip) await removeGeneration(store, cwd);
    throw error;
  }
}
