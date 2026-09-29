// Desktop browsers support new Notification(), but Android Chrome throws on it and
// only allows ServiceWorkerRegistration.showNotification(). Use the service worker
// from public/sw.js when it's active, and never let a failure crash the page.

export function registerNotificationWorker() {
  navigator.serviceWorker
    ?.register(`${import.meta.env.BASE_URL}sw.js`)
    .catch((error) => console.warn('Could not register service worker:', error));
}

export async function showNotification(title: string, options: NotificationOptions & { image?: string; vibrate?: number[] }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.active) {
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
  } catch (error) {
    console.warn('Could not show notification:', error);
  }
}
