declare module '*.css' {
  const content: string;
  export default content;
}

declare module '@capacitor/status-bar' {
  export const StatusBar: {
    setOverlaysWebView(options: { overlay: boolean }): Promise<void>;
    setBackgroundColor(options: { color: string }): Promise<void>;
    setStyle(options: { style: string }): Promise<void>;
  };

  export const Style: {
    Light: string;
    Dark: string;
  };
}

declare module '@capacitor/push-notifications' {
  export type Token = { value: string };
  export type PushNotificationSchema = {
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  };
  export type PushNotificationActionPerformed = {
    actionId: string;
    notification?: PushNotificationSchema;
  };

  export const PushNotifications: {
    checkPermissions(): Promise<{ receive?: 'granted' | 'denied' | 'prompt' }>;
    requestPermissions(): Promise<{ receive?: 'granted' | 'denied' | 'prompt' }>;
    register(): Promise<void>;
    removeAllListeners(): Promise<void>;
    addListener(eventName: string, listenerFunc: (...args: any[]) => void): Promise<import('@capacitor/core').PluginListenerHandle>;
  };
}

declare module 'firebase-admin/app' {
  export type App = any;
  export function cert(value: Record<string, unknown>): any;
  export function getApps(): App[];
  export function initializeApp(options?: Record<string, unknown>): App;
}

declare module 'firebase-admin/messaging' {
  export function getMessaging(app?: any): {
    send(message: Record<string, unknown>): Promise<string>;
    sendEachForMulticast(message: Record<string, unknown>): Promise<{
      successCount: number;
      failureCount: number;
      responses: Array<{ success: boolean; error?: unknown }>;
    }>;
  };
}
