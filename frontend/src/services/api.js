/**
 * PRAHARI-AI API Service Client
 * Encapsulates FastAPI backend communications cleanly without scattering fetch calls.
 */

export async function fetchDashboardStats() {
  const res = await fetch('/api/dashboard_stats');
  if (!res.ok) throw new Error(`Dashboard stats error: ${res.statusText}`);
  return await res.json();
}

export async function fetchRuntimeProfile() {
  const res = await fetch('/api/runtime/profile');
  if (!res.ok) throw new Error(`Runtime profile error: ${res.statusText}`);
  return await res.json();
}

export async function applyRuntimeProfile(profile) {
  const res = await fetch(`/api/runtime/profile?profile=${encodeURIComponent(profile)}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Runtime profile update error: ${res.statusText}`);
  return await res.json();
}

export async function fetchCameras() {
  const res = await fetch('/api/cameras');
  if (!res.ok) throw new Error(`Cameras fetch error: ${res.statusText}`);
  return await res.json();
}

export async function fetchAnalytics() {
  const res = await fetch('/api/analytics');
  if (!res.ok) throw new Error(`Analytics fetch error: ${res.statusText}`);
  return await res.json();
}

export async function fetchAlerts(limit = 25, cameraId = null) {
  let url = `/api/alerts?limit=${limit}`;
  if (cameraId) url += `&camera_id=${encodeURIComponent(cameraId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alerts fetch error: ${res.statusText}`);
  return await res.json();
}

export async function fetchAnprLog(limit = 25, cameraId = null) {
  let url = `/api/anpr_log?limit=${limit}`;
  if (cameraId) url += `&camera_id=${encodeURIComponent(cameraId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ANPR fetch error: ${res.statusText}`);
  return await res.json();
}

export async function fetchSecurityEvents(limit = 25, eventType = null, cameraId = null) {
  let url = `/api/security_events?limit=${limit}`;
  if (eventType) url += `&event_type=${encodeURIComponent(eventType)}`;
  if (cameraId) url += `&camera_id=${encodeURIComponent(cameraId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Security events fetch error: ${res.statusText}`);
  return await res.json();
}

export async function fetchAllEvents(limit = 25, cameraId = null) {
  const [alerts, anpr, security] = await Promise.all([
    fetchAlerts(limit, cameraId).catch(() => []),
    fetchAnprLog(limit, cameraId).catch(() => []),
    fetchSecurityEvents(limit, null, cameraId).catch(() => [])
  ]);

  const combined = [
    ...alerts.map(e => ({ ...e, id: e.id ? `alert-${e.id}` : undefined })),
    ...anpr.map(e => ({ ...e, id: e.id ? `anpr-${e.id}` : undefined })),
    ...security.map(e => ({ ...e, id: e.id ? `sec-${e.id}` : undefined }))
  ];

  combined.sort((a, b) => {
    const timeA = a.timestamp || '';
    const timeB = b.timestamp || '';
    return timeB.localeCompare(timeA);
  });

  return combined.slice(0, limit);
}

export async function fetchAvailableDevices() {
  const res = await fetch('/api/devices/discover');
  if (!res.ok) throw new Error(`Device scan error: ${res.statusText}`);
  return await res.json();
}

export async function refreshDetectedDevices() {
  const res = await fetch('/api/devices/refresh', { method: 'POST' });
  if (!res.ok) throw new Error(`Refresh devices error: ${res.statusText}`);
  return await res.json();
}

export async function connectDetectedDevice(device) {
  const res = await fetch('/api/devices/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(device)
  });
  if (!res.ok) throw new Error(`Connect device error: ${res.statusText}`);
  return await res.json();
}

export async function startWebcam(deviceIndex = 0) {
  const res = await fetch(`/api/webcam/start?device_index=${encodeURIComponent(deviceIndex)}`, {
    method: 'POST'
  });
  if (!res.ok) throw new Error(`Start webcam error: ${res.statusText}`);
  return await res.json();
}

export async function stopWebcam() {
  const res = await fetch('/api/webcam/stop', {
    method: 'POST'
  });
  if (!res.ok) throw new Error(`Stop webcam error: ${res.statusText}`);
  return await res.json();
}
