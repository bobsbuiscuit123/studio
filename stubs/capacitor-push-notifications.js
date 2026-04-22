const createListenerHandle = () => ({
  remove: async () => undefined,
});

export const PushNotifications = {
  checkPermissions: async () => ({ receive: "denied" }),
  requestPermissions: async () => ({ receive: "denied" }),
  addListener: async () => createListenerHandle(),
  register: async () => undefined,
};
