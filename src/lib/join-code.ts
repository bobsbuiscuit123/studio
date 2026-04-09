export const normalizeJoinCode = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '');
