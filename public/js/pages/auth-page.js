// Authentication pages: sign in, register, password reset.
// Uses Supabase Auth (email + password). Session handling is managed by init.js.

import { supabase, getCurrentProfile, onAuthState } from '/js/init.js';
import { showToast, showError, clearErrors, checkDbStatus } from '/js/ui.js';
import { renderAuthLinks, refreshCartCount } from '/js/nav.js';

function safeNextPage() {
  const requested = new URLSearchParams(window.location.search).get('next') || '';
  return /^[a-z0-9-]+\.html(\?[a-z0-9_=&%-]*)?$/i.test(requested) ? requested : null;
}

function authErrorMessage(error, action) {
  const message = String(error?.message || '');
  const normalized = message.toLowerCase();
  if (normalized.includes('email rate limit exceeded') || normalized.includes('rate limit')) {
    return 'Supabase is temporarily limiting emails. Wait before retrying, or configure a custom SMTP provider in Supabase Auth.';
  }
  if (normalized.includes('invalid login credentials')) {
    return 'Incorrect email or password, or your email has not been confirmed yet.';
  }
  if (normalized.includes('email not confirmed')) {
    return 'Please confirm your email using the verification link sent by Supabase before signing in.';
  }
  if (normalized.includes('fetch failed') || normalized.includes('failed to fetch')) {
    return 'Could not reach Supabase. Check the project URL and internet connection, then try again.';
  }
  return message || action + ' failed. Please try again.';
}

onAuthState(async (e) => {
  const user = e.detail?.user || null;
  const profile = user ? await getCurrentProfile() : null;
  renderAuthLinks(user, profile);
  refreshCartCount();
});

export async function setupLogin(form, defaultRedirect) {
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) {
      return showError(form, 'login-email', 'Please enter your email address and password.');
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return showError(form, 'login-email', authErrorMessage(error, 'Sign in'));
    } catch (error) {
      return showError(form, 'login-email', authErrorMessage(error, 'Sign in'));
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
    const profile = await getCurrentProfile(true);
    const next = safeNextPage() || defaultRedirect || 'index.html';
    if (profile && profile.role !== 'admin' && profile.approval_status !== 'approved') {
      showToast('Signed in! Note: your account is currently ' + profile.approval_status + ' awaiting admin review.', 'info');
    } else {
      showToast('Welcome back!');
    }
    window.location.href = next;
  });
}

export async function setupRegister(form) {
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const termsEl = form.querySelector('input[name="terms"]');
    if (!name || !email || !password) {
      return showError(form, 'reg-name', 'Please fill in all fields.');
    }
    if (password.length < 8) {
      return showError(form, 'reg-password', 'Password must be at least 8 characters.');
    }
    if (!termsEl || !termsEl.checked) {
      return showError(form, 'reg-name', 'You must accept the Terms of Service and Privacy Policy.');
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Creating account…';
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: name } }
      });
      if (error) return showError(form, 'reg-email', authErrorMessage(error, 'Create account'));
    } catch (error) {
      return showError(form, 'reg-email', authErrorMessage(error, 'Create account'));
    } finally {
      submit.disabled = false;
      submit.textContent = 'Create Account';
    }
    showToast('Application received! Confirm your email, then wait for administrator approval before shopping or selling.');
    const next = safeNextPage();
    setTimeout(() => {
      window.location.href = next ? 'login.html?next=' + encodeURIComponent(next) : 'login.html';
    }, 800);
  });
}

export async function setupReset(form) {
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const email = document.getElementById('reset-email').value.trim();
    if (!email) {
      return showError(form, 'reset-email', 'Please enter your email address.');
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) return showError(form, 'reset-email', authErrorMessage(error, 'Password reset'));
    } catch (error) {
      return showError(form, 'reset-email', authErrorMessage(error, 'Password reset'));
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send Reset Link';
    }
    form.reset();
    showToast('If an account exists for that email, a reset link has been sent.');
  });
}

checkDbStatus();
