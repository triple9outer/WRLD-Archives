const config = window.WRLD_AUTH_CONFIG || {};
const supabaseUrl = String(config.supabaseUrl || config.url || '').trim().replace(/\/+$/, '');
const publishableKey = String(config.publishableKey || config.anonKey || '').trim();

function validProjectUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}

const configured = validProjectUrl(supabaseUrl) && publishableKey.length >= 20;
let clientPromise;

async function getClient() {
  if (!configured) throw new Error('Sign-in has not been configured for this app yet.');
  if (!clientPromise) {
    clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm').then(({ createClient }) => {
      if (typeof createClient !== 'function') throw new Error('The sign-in library could not be loaded.');
      return createClient(supabaseUrl, publishableKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
          persistSession: true
        }
      });
    });
  }
  return clientPromise;
}

export function initAccountAuth() {
  const dialog = document.querySelector('#accountDialog');
  const openButton = document.querySelector('#sideAccount');
  if (!dialog || !openButton) return;

  const $ = selector => dialog.querySelector(selector);
  const setupNotice = $('#accountSetupNotice');
  const signedOut = $('#accountSignedOut');
  const signedIn = $('#accountSignedIn');
  const status = $('#accountStatus');
  const badge = document.querySelector('#accountNavState');
  let client = null;
  let pendingPhone = '';

  function setStatus(message = '', kind = 'info') {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function renderSession(session) {
    const user = session?.user || null;
    setupNotice.hidden = configured;
    signedOut.hidden = !configured || Boolean(user);
    signedIn.hidden = !user;
    if (user) {
      const metadata = user.user_metadata || {};
      const name = metadata.full_name || metadata.name || metadata.user_name || user.email || user.phone || 'Signed in';
      $('#accountIdentity').textContent = name;
      $('#accountIdentityDetail').textContent = user.email || user.phone || 'Account connected';
      if (badge) badge.textContent = 'Signed in';
    } else if (badge) {
      badge.textContent = configured ? 'Sign in' : 'Set up';
    }
  }

  async function ensureClient() {
    if (!configured) {
      setupNotice.hidden = false;
      signedOut.hidden = true;
      setStatus('Sign-in is not configured yet. Add the public Supabase project URL and publishable key to auth-config.js.', 'error');
      throw new Error('Sign-in setup is required before accounts can be used.');
    }
    client ||= await getClient();
    if (!client.authListenerAttached) {
      client.auth.onAuthStateChange((_event, session) => renderSession(session));
      client.authListenerAttached = true;
    }
    return client;
  }

  function returnUrl() {
    const url = new URL(window.location.href);
    url.hash = '';
    return url.toString();
  }

  async function openAccount() {
    if (!dialog.open) dialog.showModal();
    setStatus('');
    if (!configured) {
      renderSession(null);
      setStatus('Sign-in setup is required before people can log in.', 'info');
      return;
    }
    try {
      const auth = await ensureClient();
      const { data, error } = await auth.auth.getSession();
      if (error) throw error;
      renderSession(data.session);
    } catch (error) {
      if (client) renderSession(null);
      setStatus(error.message || 'Could not connect to the sign-in service.', 'error');
    }
  }

  openButton.addEventListener('click', openAccount);
  $('#accountClose').addEventListener('click', () => dialog.close());
  $('#accountDiscord').addEventListener('click', () => signInWithProvider('discord'));
  $('#accountGoogle').addEventListener('click', () => signInWithProvider('google'));

  async function signInWithProvider(provider) {
    try {
      const auth = await ensureClient();
      setStatus(`Opening ${provider === 'discord' ? 'Discord' : 'Google'} sign-in…`);
      const { error } = await auth.auth.signInWithOAuth({
        provider,
        options: { redirectTo: returnUrl() }
      });
      if (error) throw error;
    } catch (error) {
      setStatus(error.message || 'Could not start sign-in.', 'error');
    }
  }

  $('#accountEmailSend').addEventListener('click', async () => {
    const email = $('#accountEmail').value.trim();
    if (!email || !$('#accountEmail').checkValidity()) {
      $('#accountEmail').reportValidity();
      return;
    }
    try {
      const auth = await ensureClient();
      setStatus('Sending a sign-in link…');
      const { error } = await auth.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: returnUrl(), shouldCreateUser: true }
      });
      if (error) throw error;
      setStatus('Check your email for the sign-in link.');
    } catch (error) {
      setStatus(error.message || 'Could not send the email sign-in link.', 'error');
    }
  });

  $('#accountPhoneSend').addEventListener('click', async () => {
    const phone = $('#accountPhone').value.trim();
    if (!phone) {
      $('#accountPhone').focus();
      setStatus('Enter a phone number with its country code.', 'error');
      return;
    }
    try {
      const auth = await ensureClient();
      setStatus('Sending a one-time code…');
      const { error } = await auth.auth.signInWithOtp({ phone });
      if (error) throw error;
      pendingPhone = phone;
      $('#accountPhoneCode').hidden = false;
      $('#accountPhoneVerify').hidden = false;
      $('#accountPhoneCode').focus();
      setStatus('Enter the one-time code sent by SMS.');
    } catch (error) {
      setStatus(error.message || 'Could not send the SMS code.', 'error');
    }
  });

  $('#accountPhoneVerify').addEventListener('click', async () => {
    const token = $('#accountPhoneCode').value.trim();
    if (!pendingPhone || !token) {
      setStatus('Request an SMS code and enter it here.', 'error');
      return;
    }
    try {
      const auth = await ensureClient();
      setStatus('Checking your code…');
      const { data, error } = await auth.auth.verifyOtp({ phone: pendingPhone, token, type: 'sms' });
      if (error) throw error;
      pendingPhone = '';
      renderSession(data.session);
      setStatus('You’re signed in.');
    } catch (error) {
      setStatus(error.message || 'That code could not be verified.', 'error');
    }
  });

  $('#accountSignOut').addEventListener('click', async () => {
    try {
      const auth = await ensureClient();
      const { error } = await auth.auth.signOut();
      if (error) throw error;
      renderSession(null);
      setStatus('You’re signed out.');
    } catch (error) {
      setStatus(error.message || 'Could not sign out.', 'error');
    }
  });

  renderSession(null);
}
