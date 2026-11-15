// Browser implementation of the shared Save-menu boundary, not a Tauri shim.
export async function createSaveMenu(item:{id:string;text:string}, requestSave:()=>void) {
  const button = document.createElement('button');
  button.id = 'browser-project-save';
  button.type = 'button';button.textContent = item.text;button.disabled = true;
  button.addEventListener('click', () => {if (!button.disabled) requestSave();});
  const container = document.getElementById('browser-host-controls');
  if (!container) throw new Error('Browser Host controls are missing.');
  container.appendChild(button);
  const save = {async setEnabled(enabled:boolean) {button.disabled=!enabled;}};
  return {save,async enable(){await save.setEnabled(true);}};
}
