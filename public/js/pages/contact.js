// Contact/support form — persists to the messages table via /api/messages.
import { getCurrentProfile, onAuthState } from '/js/init.js';
import { showToast, showError, clearErrors, apiFetch, checkDbStatus } from '/js/ui.js';
import { renderAuthLinks, refreshCartCount } from '/js/nav.js';

const form = document.getElementById('contact-form');

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);

  const payload = {
    name: document.getElementById('contact-name').value.trim(),
    email: document.getElementById('contact-email').value.trim(),
    subject: document.getElementById('contact-subject').value.trim(),
    content: document.getElementById('contact-message').value.trim()
  };

  if (!payload.name) return showError(form, 'contact-name', 'Please enter your name.');
  if (!payload.email) return showError(form, 'contact-email', 'Please enter your email.');
  if (!payload.subject) return showError(form, 'contact-subject', 'Please enter a subject.');
  if (!payload.content) return showError(form, 'contact-message', 'Please enter your message.');

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Sending…';

  const res = await apiFetch('/api/messages', {
    method: 'POST',
    body: payload,
    auth: false
  });

  submit.disabled = false;
  submit.textContent = 'Send Message';

  if (!res.ok) {
    showError(form, 'contact-message', res.error || 'Could not send. Please try again later.');
    return;
  }

  showToast('Message sent! Our marketplace support team will reply via email.');
  form.reset();
});

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);
  refreshCartCount();
  if (user) {
    const nameField = document.getElementById('contact-name');
    const emailField = document.getElementById('contact-email');
    if (nameField && !nameField.value && profile?.display_name) nameField.value = profile.display_name;
    if (emailField && !emailField.value) emailField.value = profile?.email || user.email || '';
  }
});

checkDbStatus();
