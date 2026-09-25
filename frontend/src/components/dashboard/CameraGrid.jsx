import React from 'react';
import { CameraCard } from './CameraCard';

const DEFAULT_CAMERA_DEFS = [
  { id: 'CAM-01', name: 'Border Post Alpha' },
  { id: 'CAM-02', name: 'Night Surveillance Bravo' },
  { id: 'CAM-03', name: 'Perimeter Activity Charlie' },
  { id: 'CAM-04', name: 'Urban Facility Delta' },
];

export function CameraGrid({
  telemetryMap = {},
  isWebcamRunning = false,
  onFocusCamera
}) {
  const activeTelemetry = Object.values(telemetryMap).filter((cam) => {
    const connected = cam.connected !== false;
    const active = cam.active !== false;
    return connected || active;
  });

  const cards = activeTelemetry.length > 0
    ? activeTelemetry.map((cam) => {
        const cameraId = cam.camera_id || cam.id;
        const cameraName = cam.name || cameraId;
        return (
          <CameraCard
            key={cameraId}
            cameraId={cameraId}
            cameraName={cameraName}
            telemetry={cam}
            onFocus={onFocusCamera}
          />
        );
      })
    : DEFAULT_CAMERA_DEFS.filter((cam) => telemetryMap[cam.id]?.connected || telemetryMap[cam.id]?.active).map((cam) => (
        <CameraCard
          key={cam.id}
          cameraId={cam.id}
          cameraName={cam.name}
          telemetry={telemetryMap[cam.id] || {}}
          onFocus={onFocusCamera}
        />
      ));

  return (
    <section className="cc-camera-section" aria-label="Surveillance Camera Feeds">
      <div
        className={`cc-camera-grid ${isWebcamRunning ? 'has-webcam' : ''}`}
        id="commandCenterCameraGrid"
      >
        {cards.length > 0 ? cards : (
          <div style={{
            gridColumn: '1 / -1',
            background: '#101827',
            border: '1px solid #22314d',
            borderRadius: 14,
            padding: '28px 18px',
            color: '#dfe9ff',
            textAlign: 'center'
          }}>
            No working camera devices detected yet. The system is scanning for connected CCTV or webcam sources.
          </div>
        )}
      </div>
    </section>
  );
}
