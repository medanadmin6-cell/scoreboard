(() => {
  const SITE = window.SITE || {};
  document.querySelectorAll('[data-brand]').forEach((el) => { el.textContent = SITE.name || ''; });
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
  document.title = `${document.title} | ${SITE.name || ''}`;
  const email = (SITE.contactEmail || '').trim();
  document.querySelectorAll('[data-contact]').forEach((a) => { a.textContent = email; a.href = `mailto:${email}`; });
  document.querySelectorAll('[data-contact-line]').forEach((el) => { el.hidden = !email; });
  document.querySelectorAll('[data-no-contact]').forEach((el) => { el.hidden = !!email; });
})();
