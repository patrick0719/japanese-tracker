// firebase-messaging-sw.js
// Place this file in your React app's /public folder

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// ── REPLACE these values with your Firebase project config ───────────────────
// Get these from: Firebase Console → Project Settings → General → Your apps
firebase.initializeApp({
    apiKey:            "AIzaSyCkLAC0AfLo_JDEK3AYEqhPPgR9UnF_QOQ",
    authDomain:        "sage-bulacan.firebaseapp.com",
    projectId:         "sage-bulacan",
    storageBucket:     "sage-bulacan.firebasestorage.app",
    messagingSenderId: "1024431867859",
    appId:             "1:1024431867859:web:1566304d863f86838e1126",
  });

const messaging = firebase.messaging();

// Handle background notifications (when app is closed or minimized)
messaging.onBackgroundMessage((payload) => {
  console.log('[SAGE SW] Background message received:', payload);

  const { title, body, icon } = payload.notification || {};

  self.registration.showNotification(title || 'SAGE Bulacan', {
    body: body || 'May bagong reminder para sa iyo.',
    icon: icon || '/logo192.png',
    badge: '/logo192.png',
    tag: 'sage-reminder',           // replaces previous notification of same tag
    renotify: true,
    vibrate: [200, 100, 200],
    data: payload.data || {},
    actions: [
      { action: 'open', title: '📂 Buksan ang App' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  });
});

// Clicking the notification opens the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});