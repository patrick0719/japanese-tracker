// usePushNotifications.js
// Place this file next to App.js (src/usePushNotifications.js)
// Then import and call it inside App.js after login succeeds.
//
// Usage inside App.js:
//   import { usePushNotifications } from './usePushNotifications';
//   // Inside the App() component, after isLoggedIn check:
//   usePushNotifications(isLoggedIn, isViewer);

import { useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const API = 'https://japanese-tracker-production.up.railway.app/api';

// ── REPLACE these with your Firebase project config ──────────────────────────
// Firebase Console → Project Settings → General → Your apps → Web app
const firebaseConfig = {
    apiKey: "AIzaSyCkLAC0AfLo_JDEK3AYEqhPPgR9UnF_QOQ",
    authDomain: "sage-bulacan.firebaseapp.com",
    projectId: "sage-bulacan",
    storageBucket: "sage-bulacan.firebasestorage.app",
    messagingSenderId: "1024431867859",
    appId: "1:1024431867859:web:1566304d863f86838e1126",
};

// ── REPLACE with your VAPID key ───────────────────────────────────────────────
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY = "BGH0wP9Qfdk0PlkYMYDrw27kdbgakST2SHjrehQyMT5y3P-uL9MJJLHxj1iIZd7d7wMEXGP0_yi8mrX1t_4ak2I";

let firebaseApp;
let messaging;

function getFirebase() {
  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig);
    messaging = getMessaging(firebaseApp);
  }
  return { messaging };
}

export function usePushNotifications(isLoggedIn, isViewer) {
  useEffect(() => {
    // Only request permission for teachers and admins (not viewers / kumiai)
    if (!isLoggedIn || isViewer) return;

    // Check browser support
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

    const registerPush = async () => {
      try {
        // Request notification permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.log('[SAGE Push] Permission denied');
          return;
        }

        // Register service worker
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

        const { messaging } = getFirebase();

        // Get FCM token
        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration,
        });

        if (!token) {
          console.log('[SAGE Push] No FCM token received');
          return;
        }

        // Get role and teacher info for backend
        const role = localStorage.getItem('sage_role') || 'admin';
        const teacherRaw = localStorage.getItem('sage_teacher');
        const teacher = teacherRaw ? JSON.parse(teacherRaw) : null;

        // Save token to backend
        await fetch(`${API}/push/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            role,
            teacherId: teacher?._id || null,
            teacherName: teacher?.name || role,
          }),
        });

        console.log('[SAGE Push] Token registered successfully');

        // Handle foreground notifications (app is open)
        onMessage(messaging, (payload) => {
          console.log('[SAGE Push] Foreground message:', payload);
          const { title, body } = payload.notification || {};
          // Show a simple in-app toast since browser won't show native notif when app is focused
          if (title || body) {
            const event = new CustomEvent('sage-push-notification', {
              detail: { title, body }
            });
            window.dispatchEvent(event);
          }
        });

      } catch (err) {
        console.error('[SAGE Push] Error:', err);
      }
    };

    registerPush();
  }, [isLoggedIn, isViewer]);
}