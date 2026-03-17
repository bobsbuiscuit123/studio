const CLIENT_TIMEZONE_COOKIE = 'client-timezone';
const CLIENT_TIMEZONE_HEADER = 'x-timezone';

const dayKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getDayKeyFormatter = (timeZone: string) => {
  const cached = dayKeyFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  dayKeyFormatterCache.set(timeZone, formatter);
  return formatter;
};

export const getUtcDayKey = (date = new Date()) => date.toISOString().slice(0, 10);

export const getDayKeyForTimeZone = (timeZone: string, date = new Date()) =>
  getDayKeyFormatter(timeZone).format(date);

export const getValidTimeZone = (value?: string | null) => {
  if (!value) return null;
  try {
    getDayKeyFormatter(value);
    return value;
  } catch {
    return null;
  }
};

export const getClientTimeZoneFromRequest = (request: Pick<Request, 'headers'>) => {
  const headerTimeZone = getValidTimeZone(request.headers.get(CLIENT_TIMEZONE_HEADER));
  if (headerTimeZone) {
    return headerTimeZone;
  }

  const cookieHeader = request.headers.get('cookie') ?? '';
  const timeZoneCookie = cookieHeader
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${CLIENT_TIMEZONE_COOKIE}=`));

  if (!timeZoneCookie) {
    return null;
  }

  const [, rawValue = ''] = timeZoneCookie.split('=');
  return getValidTimeZone(decodeURIComponent(rawValue));
};

export const getRequestDayKey = (request: Pick<Request, 'headers'>, date = new Date()) => {
  const timeZone = getClientTimeZoneFromRequest(request);
  return timeZone ? getDayKeyForTimeZone(timeZone, date) : getUtcDayKey(date);
};

export const getClientTimeZoneCookieName = () => CLIENT_TIMEZONE_COOKIE;
export const getClientTimeZoneHeaderName = () => CLIENT_TIMEZONE_HEADER;
