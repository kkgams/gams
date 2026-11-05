const header = document.querySelector('#site-nav');
const resources = header.querySelector('.resources');
const toggle = header.querySelector('.menu-toggle');
const navigation = header.querySelector('#main-links');
if (!resources || !toggle || !navigation) throw new Error('Site navigation markup is incomplete.');

function closeMenu() {
    header.classList.remove('is-menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open main menu');
    resources.open = false;
}

toggle.hidden = false;
toggle.addEventListener('click', () => {
    const open = header.classList.toggle('is-menu-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close main menu' : 'Open main menu');
    if (!open) resources.open = false;
});
document.addEventListener('click', event => {
    if (!resources.contains(event.target)) resources.open = false;
    if (!header.contains(event.target)) closeMenu();
});
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (resources.open) {
        resources.open = false;
        resources.querySelector('summary').focus();
        event.preventDefault();
    } else if (header.classList.contains('is-menu-open')) {
        closeMenu();
        toggle.focus();
        event.preventDefault();
    }
});
header.addEventListener('focusout', event => {
    if (!header.contains(event.relatedTarget)) closeMenu();
    else if (!resources.contains(event.relatedTarget)) resources.open = false;
});
navigation.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
});
matchMedia('(max-width: 699px)').addEventListener('change', closeMenu);
