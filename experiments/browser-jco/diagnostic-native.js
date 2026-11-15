// The canonical Runtime is shared. Only its platform transport changes.
// Retain the isolated fixed Files milestone on its original URL.
const platform = await import(location.pathname.endsWith('/files.html')
  ? '/files-transport.js' : '/browser-transport.js');
export const invokeCommand = platform.invokeCommand;
export const listenEvent = platform.listenEvent;
export const createProgressChannel = platform.createProgressChannel;

function fixed(name, args) {
  if (!location.pathname.endsWith('/files.html')) throw new Error(`${name} belongs to the fixed Files experiment.`);
  return platform[name](...args);
}
export const openSession = (...args) => fixed('openSession', args);
export const closeSession = (...args) => fixed('closeSession', args);
export const forceStopSession = (...args) => fixed('forceStopSession', args);
export const hasSession = (...args) => fixed('hasSession', args);
