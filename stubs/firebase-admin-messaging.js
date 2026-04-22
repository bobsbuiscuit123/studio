export const getMessaging = () => ({
  send: async () => {
    const error = new Error("Firebase Admin messaging is unavailable in this environment.");
    error.code = "messaging/unavailable";
    throw error;
  },
});
