// Apply the saved theme before styles paint, then wire up the visible control.
(() => {
    const key = 'gams-promo-theme';
    const root = document.documentElement;
    const system = matchMedia('(prefers-color-scheme: light)');
    let preference = null;
    function storageFailure(error) {
        if (!['SecurityError', 'QuotaExceededError'].includes(error.name)) throw error;
        console.warn('Theme preference cannot be saved in this browser.', error.name);
    }
    try {
        const saved = localStorage.getItem(key);
        if (saved === 'light' || saved === 'dark') preference = saved;
    } catch (error) {
        storageFailure(error);
    }
    function apply(theme) {
        root.dataset.theme = theme;
        const next = theme === 'dark' ? 'light' : 'dark';
        for (const button of document.querySelectorAll('.theme-toggle')) {
            button.setAttribute('aria-label', `Switch to ${next} theme`);
            button.title = `Switch to ${next} theme`;
        }
        document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#111315' : '#f4f3ef';
    }
    root.classList.add('js');
    apply(preference || (system.matches ? 'light' : 'dark'));
    system.addEventListener('change', () => {
        if (!preference) apply(system.matches ? 'light' : 'dark');
    });
    document.addEventListener('DOMContentLoaded', () => {
        apply(root.dataset.theme);
        for (const button of document.querySelectorAll('.theme-toggle')) {
            button.hidden = false;
            button.addEventListener('click', () => {
                preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
                apply(preference);
                try {
                    localStorage.setItem(key, preference);
                } catch (error) {
                    storageFailure(error);
                }
            });
        }
    });
})();
