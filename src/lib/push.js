// Device push registration for the Android APK (Capacitor + Firebase Cloud
// Messaging). On web / PWA this is a no-op — there's no FCM token without the
// native layer, and the daily-coach push only targets the APK for now.
//
// Flow: ask for notification permission → register with FCM → on the
// 'registration' event, store the token in push_subscriptions so the
// server-side Edge Function can push to this device. Idempotent + guarded so
// repeated calls (e.g. AuthedApp re-mounts) don't stack listeners.
//
// NOTE (Phase 1): we register on startup once the user is logged in, so the
// token lands in the DB for end-to-end testing. In Phase 2 this moves behind
// the "enable daily push" toggle so we only prompt when the user opts in.

import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';
import * as db from './db';

let initializedForUserId = "";
let getuiListener = null;
const PUSH_TOKEN_STORAGE_KEY = "ultreia.push.fcmToken";
const GETUI_CID_STORAGE_KEY = "ultreia.push.getuiCid";
const PUSH_DEBUG_STORAGE_KEY = "ultreia.push.debug";
const DAILY_COACH_CHANNEL_ID = "daily_coach";
const WALLET_ALERTS_CHANNEL_ID = "wallet_alerts_v1";

const UltreiaGetui = registerPlugin('UltreiaGetui');
const UltreiaKeepAlive = registerPlugin('UltreiaKeepAlive');

function appendPushDebug(event, detail = {}) {
  try {
    const rows = JSON.parse(localStorage.getItem(PUSH_DEBUG_STORAGE_KEY) || "[]");
    rows.unshift({ event, detail, at: new Date().toISOString() });
    localStorage.setItem(PUSH_DEBUG_STORAGE_KEY, JSON.stringify(rows.slice(0, 20)));
  } catch (err) {
    console.warn('[push] debug log failed (non-fatal):', err);
  }
}

async function deleteCachedPushToken() {
  let token = "";
  try {
    token = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY) || "";
  } catch (err) {
    console.warn('[push] token cache read failed (non-fatal):', err);
  }
  if (token) {
    await db.pushSubscriptions.deleteMyToken(token).catch((err) => {
      console.warn('[push] token delete failed:', err);
    });
  }
  try {
    localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch (err) {
    console.warn('[push] token cache clear failed (non-fatal):', err);
  }
}

async function upsertGetuiClientId(cid) {
  if (!cid) return;
  try {
    localStorage.setItem(GETUI_CID_STORAGE_KEY, cid);
  } catch (err) {
    console.warn('[push] getui cid cache failed (non-fatal):', err);
  }
  await db.getuiDevices.upsertMyClientId(cid, 'android').catch((err) => {
    console.error('[push] getui cid upsert failed:', err);
  });
  appendPushDebug('getuiCid', { cidPrefix: `${cid.slice(0, 10)}...` });
}

async function initGetuiPush() {
  if (!getuiListener) {
    getuiListener = await UltreiaGetui.addListener('getuiClientId', (event) => {
      void upsertGetuiClientId(event?.cid || "");
    });
  }
  try {
    const result = await UltreiaGetui.initialize();
    await upsertGetuiClientId(result?.cid || "");
    appendPushDebug('getuiInitialized', { hasCid: Boolean(result?.cid) });
  } catch (err) {
    getuiListener?.remove?.();
    getuiListener = null;
    console.warn('[push] getui init failed:', err);
    appendPushDebug('getuiInitFailed', { message: err?.message || String(err) });
  }
}

export async function setPushKeepAliveEnabled(enabled, summary = {}) {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    if (enabled) {
      await UltreiaKeepAlive.start({
        title: summary.title || "This month",
        body: summary.body || "Sessions   0     · Time      0m\nDistance   0.0km · Ascent     0m",
      });
      appendPushDebug('keepAliveStarted', summary);
    } else {
      await UltreiaKeepAlive.stop();
      appendPushDebug('keepAliveStopped');
    }
  } catch (err) {
    console.warn('[push] keep-alive service update failed:', err);
    appendPushDebug('keepAliveFailed', { enabled, message: err?.message || String(err) });
  }
}

export async function notifyTaskDone({ title = "Ultreia", body = "Ready." } = {}) {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await UltreiaKeepAlive.notifyDone({ title, body });
    appendPushDebug('taskDoneNotification', { title, body });
  } catch (err) {
    console.warn('[push] task-done notification failed:', err);
    appendPushDebug('taskDoneNotificationFailed', { message: err?.message || String(err) });
  }
}

export async function initPushNotifications(userId) {
  if (!userId) return;
  if (initializedForUserId === userId) return;
  // Android-only for now. iOS would need APNs setup; web has no FCM token.
  if (Capacitor.getPlatform() !== 'android') return;
  initializedForUserId = userId;

  // Import lazily so the web bundle never pulls the native plugin shim into a
  // code path that runs on load.
  const { PushNotifications } = await import('@capacitor/push-notifications');

  PushNotifications.addListener('registration', (token) => {
    try {
      localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token.value);
    } catch (err) {
      console.warn('[push] token cache failed (non-fatal):', err);
    }
    db.pushSubscriptions.upsertMyToken(token.value, 'android').catch((err) => {
      console.error('[push] token upsert failed:', err);
    });
    appendPushDebug('registration', { tokenPrefix: `${token.value.slice(0, 12)}...` });
  });
  PushNotifications.addListener('registrationError', (err) => {
    console.error('[push] registration error:', err);
    appendPushDebug('registrationError', err);
  });
  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.info('[push] notification received:', notification);
    appendPushDebug('received', {
      title: notification?.title || "",
      body: notification?.body || "",
      data: notification?.data || null,
    });
  });
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    console.info('[push] notification action:', action);
    appendPushDebug('action', {
      actionId: action?.actionId || "",
      title: action?.notification?.title || "",
      data: action?.notification?.data || null,
    });
  });

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      console.info('[push] notification permission not granted:', perm.receive);
      appendPushDebug('permissionDenied', { receive: perm.receive });
      await deleteCachedPushToken();
      return;
    }
    appendPushDebug('permissionGranted', { receive: perm.receive });
    await initGetuiPush();
    // Android 8+ requires a notification channel or the tray notification is
    // silently dropped. Safe to call repeatedly — Android upserts by id.
    try {
      await PushNotifications.createChannel({
        id: DAILY_COACH_CHANNEL_ID,
        name: 'Daily coach',
        description: 'Your daily AI coach check-in',
        importance: 5,
        visibility: 1,
      });
      await PushNotifications.createChannel({
        id: WALLET_ALERTS_CHANNEL_ID,
        name: 'Wallet alerts',
        description: 'Wallet top-up and payment reminders',
        importance: 5,
        visibility: 1,
      });
      appendPushDebug('channelsCreated', {
        channels: [DAILY_COACH_CHANNEL_ID, WALLET_ALERTS_CHANNEL_ID],
      });
    } catch (err) {
      console.warn('[push] createChannel failed (non-fatal):', err);
      appendPushDebug('createChannelFailed', { message: err?.message || String(err) });
    }
    await PushNotifications.register();
  } catch (err) {
    initializedForUserId = "";
    console.error('[push] init failed:', err);
    appendPushDebug('initFailed', { message: err?.message || String(err) });
  }
}

export async function clearPushRegistrationForCurrentUser() {
  if (Capacitor.getPlatform() !== 'android') return;
  await setPushKeepAliveEnabled(false);
  await deleteCachedPushToken();
  let cid = "";
  try {
    cid = localStorage.getItem(GETUI_CID_STORAGE_KEY) || "";
  } catch (err) {
    console.warn('[push] getui cid cache read failed (non-fatal):', err);
  }
  if (cid) {
    await db.getuiDevices.deleteMyClientId(cid).catch((err) => {
      console.warn('[push] getui cid delete failed:', err);
    });
  }
  try {
    localStorage.removeItem(GETUI_CID_STORAGE_KEY);
  } catch (err) {
    console.warn('[push] getui cid cache clear failed (non-fatal):', err);
  }
  initializedForUserId = "";
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllListeners();
    getuiListener?.remove?.();
    getuiListener = null;
  } catch (err) {
    console.warn('[push] remove listeners failed (non-fatal):', err);
  }
}
