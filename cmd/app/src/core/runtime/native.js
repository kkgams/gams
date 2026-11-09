export const invokeCommand = globalThis.__TAURI__.core.invoke
let tauriListen = null

export async function listenEvent(event, callback) {
  if (tauriListen) return await tauriListen(event, callback)

  if (!globalThis.__TAURI__?.event?.listen) {
    throw new Error(
      "Tauri event API is unavailable; cmd/app requires app.withGlobalTauri = true",
    )
  }

  tauriListen = globalThis.__TAURI__.event.listen
  return await tauriListen(event, callback)
}

export function createProgressChannel(onProgress) {
  const channel = new globalThis.__TAURI__.core.Channel()
  channel.onmessage = onProgress
  return channel
}
