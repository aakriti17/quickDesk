import axios from 'axios';

// Frontend and backend are now served from the SAME origin
// (the FastAPI backend serves the built React app directly -
// see frontend/build + the static mount in backend/app/main.py).
// So by default, just talk to whatever origin the page itself
// was loaded from - this works automatically for:
//   http://localhost:9000
//   http://<lan-ip>:9000
//   https://<your-app>.ngrok-free.dev
//
// REACT_APP_BACKEND_URL (frontend/.env) can still override this,
// but for the single-port setup you normally won't need it.
const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL ||
  window.location.origin;

const API_BASE_URL = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const createSession = async (sessionData) => {
  const response = await api.post('/sessions/create', sessionData);
  return response.data;
};

export const getSessionStatus = async (sessionId) => {
  const response = await api.get(`/sessions/${sessionId}/status`);
  return response.data;
};

export const connectToSession = async (sessionId, data) => {
  const response = await api.post(`/sessions/${sessionId}/connect`, data);
  return response.data;
};

export const approveConnection = async (
  sessionId,
  connectionId,
  approved
) => {
  const response = await api.post(
    `/sessions/${sessionId}/approve`,
    null,
    {
      params: {
        connection_id: connectionId,
        approved: approved,
      },
    }
  );

  return response.data;
};

export const terminateSession = async (sessionId) => {
  const response = await api.post(`/sessions/${sessionId}/terminate`);
  return response.data;
};

export const listSessions = async () => {
  const response = await api.get('/sessions/list');
  return response.data;
};

export { BACKEND_URL };

export default api;