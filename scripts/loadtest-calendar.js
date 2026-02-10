import http from 'k6/http';
import { sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '60s', target: 10 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  const payload = JSON.stringify({ prompt: 'Schedule a meeting tomorrow at 3pm' });
  const params = { headers: { 'Content-Type': 'application/json' } };
  http.post(`${BASE_URL}/api/calendar/ai`, payload, params);
  sleep(1);
}

