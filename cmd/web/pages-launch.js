import { createStartupProgress } from '/core/startup-progress.js';

const reloadKey = 'gams-pages-isolation-reload';
try {
    if (crossOriginIsolated) {
        sessionStorage.removeItem(reloadKey);
        await import('/browser-launch.js');
    } else {
        if (sessionStorage.getItem(reloadKey)) throw new Error('GAMS could not enable cross-origin isolation.');
        const workers = navigator.serviceWorker;
        if (!workers) throw new Error('GAMS needs service worker support to enable browser storage on this site.');
        let onChange;
        let timer;
        const controlled = new Promise((resolve, reject) => {
            onChange = () => { if (workers.controller) resolve(); };
            workers.addEventListener('controllerchange', onChange);
            timer = setTimeout(() => reject(new Error('Timed out enabling browser storage.')), 10000);
        });
        try {
            await Promise.all([workers.register('/pages-isolation-sw.js', { scope: '/' }).then(onChange), controlled]);
            sessionStorage.setItem(reloadKey, '1');
            location.reload();
        } finally {
            clearTimeout(timer);
            workers.removeEventListener('controllerchange', onChange);
        }
    }
} catch (error) {
    sessionStorage.removeItem(reloadKey);
    createStartupProgress(document, () => location.reload()).fail(error);
}
