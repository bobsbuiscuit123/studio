import { cert, getApps, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';

const getFirebaseCredentials = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase Admin env vars.');
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
};

export const getFirebaseAdminApp = (): App => {
  const existingApp = getApps()[0];
  if (existingApp) {
    return existingApp;
  }

  const credentials = getFirebaseCredentials();
  return initializeApp({
    credential: cert(credentials),
  });
};
