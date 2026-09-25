import React, { useState, useEffect } from 'react';
import {
  Video, Edit2, CheckCircle2, XCircle, RefreshCw,
  AlertCircle, AlertTriangle, ShieldCheck, Moon, Car, X
} from 'lucide-react';
import {
  fetchAdminCameras, updateAdminCamera,
  fetchAdminZones, createAdminZone, updateAdminZone
} from '../../services/adminApi';
import { fetchAvailableDevices, connectDetectedDevice } from '../../services/api';
import { CameraStream } from '../CameraStream';

export function AdminCameras({ currentUser }) {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [connectingCamera, setConnectingCamera] = useState(null);

  const [editingCamera, setEditingCamera] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [roiDraft, setRoiDraft] = useState(null);
  const [roiDrawing, setRoiDrawing] = useState(false);
  const roiStageRef = React.useRef(null);

  const loadCameras = async () => {
    try {
      setLoading(true);
      setError(null);
      const [inventoryResult, discoveryResult] = await Promise.allSettled([
        fetchAdminCameras(),
        fetchAvailableDevices()
      ]);
      if (inventoryResult.status === 'rejected') throw inventoryResult.reason;
      const inventory = inventoryResult.value;
      const discovery = discoveryResult.status === 'fulfilled' ? discoveryResult.value : { devices: [] };
      if (discoveryResult.status === 'rejected') {
        setError(`Device scan unavailable: ${discoveryResult.reason?.message || 'try again shortly'}`);
      }
      const inventoryById = new Map((Array.isArray(inventory) ? inventory : []).map((camera) => [camera.camera_id, camera]));
      const discoveredDevices = Array.isArray(discovery?.devices) ? discovery.devices : [];
      const available = discoveredDevices.length > 0
        ? discoveredDevices
        : (Array.isArray(inventory) ? inventory.filter((camera) => camera.connected || camera.status === 'ONLINE') : []).map((camera) => ({
          id: camera.camera_id,
          name: camera.name,
          type: camera.source_type === 'WEBCAM' ? 'webcam' : 'rtsp',
          status: camera.status,
          connected: true
        }));
      setCameras(available.map((device) => {
        const configured = inventoryById.get(device.id) || {};
        return {
          ...configured,
          camera_id: device.id,
          name: configured.name || device.name,
          location_zone: configured.location_zone || 'Unassigned',
          source_type: device.type === 'webcam' ? 'WEBCAM' : 'RTSP_STREAM',
          status: configured.status || 'AVAILABLE',
          connected: Boolean(configured.connected || device.connected),
          available_device: device
        };
      }));
    } catch (err) {
      setError(err.message || 'Failed to load camera inventory.');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectCamera = async (camera) => {
    const device = camera.available_device;
    if (!device || connectingCamera) return;
    try {
      setConnectingCamera(camera.camera_id);
      setError(null);
      const result = await connectDetectedDevice({
        device_type: device.type,
        device_id: device.id,
        device_value: device.type === 'webcam' ? device.index : device.url,
        device_name: device.name,
        url: device.type === 'rtsp' ? device.url : null
      });
      if (!['connected', 'already_connected'].includes(result.status)) {
        throw new Error(result.error || 'Camera connection failed.');
      }
      setActionSuccess(`${camera.camera_id} connected successfully.`);
      setTimeout(() => setActionSuccess(null), 3500);
      await loadCameras();
    } catch (err) {
      setError(err.message || `Failed to connect ${camera.camera_id}.`);
    } finally {
      setConnectingCamera(null);
    }
  };

  useEffect(() => {
    loadCameras();
    const interval = setInterval(loadCameras, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveCamera = async (e) => {
    e.preventDefault();
    if (!editingCamera) return;

    try {
      setModalLoading(true);
      setModalError(null);

      await updateAdminCamera(editingCamera.camera_id, {
        name: editingCamera.name,
        location_zone: editingCamera.location_zone,
        ai_enabled: editingCamera.ai_enabled,
        anpr_enabled: editingCamera.anpr_enabled,
        night_detection: editingCamera.night_detection
      });

      const fenceRatio = Number(editingCamera.fence_ratio ?? 0.70);
      const fenceDirection = editingCamera.fence_direction || 'BOTH';
      const roi = roiDraft || {};
      if (editingCamera.zone_id) {
        await updateAdminZone(editingCamera.zone_id, {
          fence_ratio: fenceRatio,
          fence_direction: fenceDirection,
          roi_x1: roi.x1, roi_y1: roi.y1, roi_x2: roi.x2, roi_y2: roi.y2
        });
      } else {
        const zones = await fetchAdminZones(editingCamera.camera_id, null);
        const activeZone = Array.isArray(zones) ? zones.find((zone) => zone.is_enabled) : null;
        if (activeZone) {
          await updateAdminZone(activeZone.id, {
            fence_ratio: fenceRatio,
            fence_direction: fenceDirection,
            roi_x1: roi.x1, roi_y1: roi.y1, roi_x2: roi.x2, roi_y2: roi.y2
          });
        } else {
          await createAdminZone({
            zone_name: editingCamera.location_zone || `${editingCamera.camera_id} Virtual Fence`,
            camera_id: editingCamera.camera_id,
            zone_type: 'RESTRICTED',
            severity: 'HIGH',
            is_enabled: 1,
            fence_direction: fenceDirection,
            fence_ratio: fenceRatio,
            roi_x1: roi.x1, roi_y1: roi.y1, roi_x2: roi.x2, roi_y2: roi.y2
          });
        }
      }

      setActionSuccess(`Camera ${editingCamera.camera_id} updated successfully.`);
      setTimeout(() => setActionSuccess(null), 3500);
      setEditingCamera(null);
      loadCameras();
    } catch (err) {
      setModalError(err.message || 'Failed to update camera.');
    } finally {
      setModalLoading(false);
    }
  };

  const canEdit = currentUser && ['SUPER_ADMIN', 'ADMIN'].includes(currentUser.role);

  const pointFromEvent = (event) => {
    const bounds = roiStageRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
    };
  };

  const startRoiDraw = (event) => {
    const point = pointFromEvent(event);
    if (!point) return;
    setRoiDrawing(true);
    setRoiDraft({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
  };

  const updateRoiDraw = (event) => {
    if (!roiDrawing) return;
    const point = pointFromEvent(event);
    if (!point) return;
    setRoiDraft((previous) => ({ ...previous, x2: point.x, y2: point.y }));
  };

  const finishRoiDraw = () => {
    setRoiDrawing(false);
    setRoiDraft((previous) => {
      if (!previous) return previous;
      return {
        x1: Math.min(previous.x1, previous.x2),
        y1: Math.min(previous.y1, previous.y2),
        x2: Math.max(previous.x1, previous.x2),
        y2: Math.max(previous.y1, previous.y2)
      };
    });
  };

  return (
    <div className="admin-page-content">
      <div className="admin-page-header">
        <div>
          <h2>Surveillance Camera Infrastructure</h2>
          <p className="admin-subtitle">Live stream health, AI pipeline orchestration, and location metadata</p>
        </div>
        <button className="btn-admin-secondary" onClick={loadCameras} title="Refresh Cameras">
          <RefreshCw style={{ width: 14, height: 14 }} className={loading ? 'spin-icon' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {actionSuccess && (
        <div className="admin-alert-success">
          <CheckCircle2 style={{ width: 16, height: 16 }} />
          <span>{actionSuccess}</span>
        </div>
      )}

      {error && (
        <div className="admin-error-box">
          <AlertCircle style={{ width: 18, height: 18 }} />
          <span>{error}</span>
          <button className="btn-admin-secondary" onClick={loadCameras}>Retry</button>
        </div>
      )}

      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Camera ID</th>
              <th>Name</th>
              <th>Location / Zone</th>
              <th>Source Type</th>
              <th>Status</th>
              <th>Telemetry / FPS</th>
              <th>AI Detection</th>
              <th>ANPR</th>
              <th>Night Mode</th>
              {canEdit && <th style={{ textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {cameras.length === 0 ? (
              <tr>
                <td colSpan={10} className="admin-empty-cell">
                  {loading ? 'Loading camera inventory...' : 'No active cameras found.'}
                </td>
              </tr>
            ) : (
              cameras.map((c) => (
                <tr key={c.camera_id}>
                  <td><span className="cam-badge">{c.camera_id}</span></td>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.location_zone}</td>
                  <td className="mono-cell" style={{ fontSize: '0.75rem' }}>{c.source_type}</td>
                  <td>
                    {c.status === 'ONLINE' ? (
                      <span className="status-indicator-pill active">
                        <CheckCircle2 style={{ width: 12, height: 12 }} /> ONLINE
                      </span>
                    ) : c.status === 'DEGRADED' ? (
                      <span className="status-indicator-pill warning" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#eab308' }}>
                        <AlertTriangle style={{ width: 12, height: 12 }} /> DEGRADED
                      </span>
                    ) : c.status === 'AVAILABLE' ? (
                      <span className="status-indicator-pill active">
                        <CheckCircle2 style={{ width: 12, height: 12 }} /> AVAILABLE
                      </span>
                    ) : (
                      <span className="status-indicator-pill disabled">
                        <XCircle style={{ width: 12, height: 12 }} /> OFFLINE
                      </span>
                    )}
                    {c.last_frame_age_seconds !== null && c.last_frame_age_seconds !== undefined && (
                      <div style={{ fontSize: '0.70rem', color: '#94a3b8', marginTop: 2 }}>
                        {c.last_frame_age_seconds < 1.0 ? 'Live (<1s)' : `${c.last_frame_age_seconds}s ago`}
                      </div>
                    )}
                  </td>
                  <td className="mono-cell" style={{ whiteSpace: 'nowrap' }}>
                    <div>
                      <span style={{ color: '#06b6d4', fontWeight: 600 }}>{c.ai_fps !== undefined ? c.ai_fps : c.fps}</span>{' '}
                      <span style={{ fontSize: '0.70rem', color: '#94a3b8' }}>AI FPS</span>
                    </div>
                    {c.capture_fps !== undefined && c.capture_fps > 0 && (
                      <div style={{ fontSize: '0.70rem', color: '#64748b' }}>
                        <span>{c.capture_fps}</span> Cap FPS
                      </div>
                    )}
                  </td>
                  <td>
                    {c.ai_enabled ? (
                      <span className="tag-pill tag-teal"><ShieldCheck style={{ width: 11, height: 11 }} /> Active</span>
                    ) : (
                      <span className="tag-pill tag-muted">Off</span>
                    )}
                  </td>
                  <td>
                    {c.anpr_enabled ? (
                      <span className="tag-pill tag-blue"><Car style={{ width: 11, height: 11 }} /> Enabled</span>
                    ) : (
                      <span className="tag-pill tag-muted">Disabled</span>
                    )}
                  </td>
                  <td>
                    {c.night_detection ? (
                      <span className="tag-pill tag-purple"><Moon style={{ width: 11, height: 11 }} /> Night Mode</span>
                    ) : (
                      <span className="tag-pill tag-muted">Standard</span>
                    )}
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <button
                          className="btn-admin-secondary"
                          type="button"
                          disabled={c.connected || connectingCamera === c.camera_id}
                          onClick={() => handleConnectCamera(c)}
                        >
                          <span>{connectingCamera === c.camera_id ? 'Connecting...' : c.connected ? 'Connected' : 'Connect'}</span>
                        </button>
                        {c.connected && (
                          <button
                            className="btn-action-icon"
                            title="Configure Camera"
                            onClick={() => {
                              setModalError(null);
                              setEditingCamera({ ...c });
                              setRoiDraft(c.roi_x1 !== null && c.roi_x1 !== undefined ? {
                                x1: c.roi_x1, y1: c.roi_y1, x2: c.roi_x2, y2: c.roi_y2
                              } : null);
                            }}
                          >
                            <Edit2 style={{ width: 14, height: 14 }} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Camera Modal */}
      {editingCamera && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal-box">
            <div className="admin-modal-header">
              <h3>Configure: {editingCamera.camera_id}</h3>
              <button className="btn-close-modal" onClick={() => setEditingCamera(null)}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            {modalError && (
              <div className="admin-login-error" style={{ margin: '0.75rem 1.25rem 0' }}>
                <AlertCircle style={{ width: 15, height: 15 }} />
                <span>{modalError}</span>
              </div>
            )}

            <div
              ref={roiStageRef}
              onMouseDown={startRoiDraw}
              onMouseMove={updateRoiDraw}
              onMouseUp={finishRoiDraw}
              onMouseLeave={finishRoiDraw}
              onDragStart={(event) => event.preventDefault()}
              className="admin-roi-stage"
              style={{ position: 'relative', margin: '1rem 1.25rem 0', aspectRatio: '4 / 3', minHeight: 260, overflow: 'hidden', background: '#0e131d', borderRadius: 8, cursor: 'crosshair' }}
            >
              <CameraStream cameraId={editingCamera.camera_id} altText={`Live configuration view for ${editingCamera.camera_id}`} className="admin-roi-live-stream" />
              <div style={{ position: 'absolute', left: 0, right: 0, top: `${Number(editingCamera.fence_ratio ?? 0.70) * 100}%`, borderTop: '2px solid #ff3b30', pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', left: 8, top: 4, padding: '2px 5px', color: '#fff', background: 'rgba(190, 20, 20, 0.82)', borderRadius: 3, fontSize: 10, fontWeight: 700 }}>VIRTUAL FENCE</span>
              </div>
              {roiDraft && (
                <div style={{ position: 'absolute', left: `${roiDraft.x1 * 100}%`, top: `${roiDraft.y1 * 100}%`, width: `${(roiDraft.x2 - roiDraft.x1) * 100}%`, height: `${(roiDraft.y2 - roiDraft.y1) * 100}%`, border: '2px solid #00d9ff', background: 'rgba(0, 217, 255, 0.14)', pointerEvents: 'none' }} />
              )}
            </div>
            <p style={{ margin: '0.55rem 1.25rem 0', color: 'var(--text-muted)', fontSize: '0.78rem' }}>Drag on the live camera to draw the AI detection box. Only activity inside it will be processed.</p>

            <form onSubmit={handleSaveCamera} className="admin-modal-form">
              <div className="form-group">
                <label>Camera Friendly Name</label>
                <input
                  type="text"
                  required
                  value={editingCamera.name}
                  onChange={(e) => setEditingCamera({ ...editingCamera, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Assigned Zone / Sector</label>
                <input
                  type="text"
                  required
                  value={editingCamera.location_zone}
                  onChange={(e) => setEditingCamera({ ...editingCamera, location_zone: e.target.value })}
                />
              </div>

              <div className="form-group-checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={editingCamera.ai_enabled}
                    onChange={(e) => setEditingCamera({ ...editingCamera, ai_enabled: e.target.checked })}
                  />
                  <span>Enable YOLOv8 Detection & Tracking</span>
                </label>
              </div>

              <div className="form-group-checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={editingCamera.anpr_enabled}
                    onChange={(e) => setEditingCamera({ ...editingCamera, anpr_enabled: e.target.checked })}
                  />
                  <span>Enable ANPR License Plate Recognition</span>
                </label>
              </div>

              <div className="form-group-checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={editingCamera.night_detection}
                    onChange={(e) => setEditingCamera({ ...editingCamera, night_detection: e.target.checked })}
                  />
                  <span>Enable Night Movement & Low-Light Enhancement</span>
                </label>
              </div>

              <div className="form-group">
                <label>Virtual Fence Position ({Math.round(Number(editingCamera.fence_ratio ?? 0.70) * 100)}%)</label>
                <input
                  type="range"
                  min="5"
                  max="95"
                  step="1"
                  value={Math.round(Number(editingCamera.fence_ratio ?? 0.70) * 100)}
                  onChange={(e) => setEditingCamera({ ...editingCamera, fence_ratio: Number(e.target.value) / 100 })}
                />
                <small style={{ color: 'var(--text-muted)' }}>Move the intrusion boundary vertically across the camera frame.</small>
              </div>

              <div className="form-group">
                <label>Fence Direction</label>
                <select
                  value={editingCamera.fence_direction || 'BOTH'}
                  onChange={(e) => setEditingCamera({ ...editingCamera, fence_direction: e.target.value })}
                >
                  <option value="BOTH">Both directions</option>
                  <option value="IN">Entering only</option>
                  <option value="OUT">Exiting only</option>
                </select>
              </div>

              <div className="admin-modal-actions">
                <button
                  type="button"
                  className="btn-admin-secondary"
                  onClick={() => setEditingCamera(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-admin-primary" disabled={modalLoading}>
                  {modalLoading ? 'Saving...' : 'Update Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
