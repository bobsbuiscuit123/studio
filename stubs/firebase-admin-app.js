const apps = [];

export const cert = (value) => value;

export const getApps = () => apps;

export const initializeApp = (config) => {
  const app = { config };
  apps.push(app);
  return app;
};
