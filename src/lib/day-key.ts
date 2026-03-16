export const getUtcDayKey = (date = new Date()) => date.toISOString().slice(0, 10);
